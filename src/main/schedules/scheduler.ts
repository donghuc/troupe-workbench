import { Notification } from 'electron'
import { senderForRun, isHeadless, broadcastConversationsChanged } from '../agent/headless'
import { startTurn, isBusy } from '../agent/turns'
import { createConversation, getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { listDue, markRan, setScheduleConv, advanceNextRun } from './schedulesRepo'
import { logInfo, logError } from '../util/logger'
import type { Schedule } from '../../shared/types'
import { getSetting } from '../database/settingsRepo'
import { enabledProviderIds, offMessage, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { scheduledRunMarker } from '../../shared/contextBudget'

let timer: ReturnType<typeof setInterval> | null = null

function notify(title: string, body: string): void {
  try { if (Notification.isSupported()) new Notification({ title, body }).show() } catch { /* best-effort */ }
}

// Fire one schedule: new thread in its project, seed the prompt, run headlessly.
function fire(s: Schedule): void {
  const project = getProject(s.projectId)
  if (!project) return
  try {
    const label = s.title.trim() || 'Scheduled task'
    // D-071: a task whose agent is turned off is skipped (no empty thread is created).
    if (!enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(s.provider)) {
      markRan(s.id, Date.now())
      logInfo(`[scheduler] skipped "${label}" — ${s.provider} is turned off`)
      notify('Workbench · task skipped', `“${label}” didn't run: ${offMessage([s.provider])}`)
      return
    }
    // Target 'same' reuses one thread across runs; 'new' makes a fresh one each time.
    let convId = s.target === 'same' && s.convId && getConversation(s.convId) ? s.convId : null
    const freshThread = !convId
    if (!convId) {
      convId = createConversation(s.projectId, `${label} · ${new Date().toLocaleDateString()}`, s.provider).id
      if (s.target === 'same') setScheduleConv(s.id, convId)
      broadcastConversationsChanged()   // D-117: the new thread shows up without a reload
    }
    // A fresh thread is seeded with the full instruction (documents the task once).
    // On a reused thread the instruction is pinned into the context by the context
    // builder (D-084 #2), so later runs only append a short dated marker — the same
    // prompt is never shown again — and the agent builds on prior runs.
    const when = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const prompt = freshThread ? s.prompt : scheduledRunMarker(when)
    markRan(s.id, Date.now()) // advance next_run_at now so it can't double-fire
    if (isBusy(convId)) {
      // D-061: never interleave a scheduled run with a turn already in flight.
      logInfo(`[scheduler] skipped "${label}" — conversation busy`)
      notify('Workbench · task skipped', `“${label}” was due while its thread was busy. It runs at the next scheduled time.`)
      return
    }
    const sender = senderForRun()
    logInfo(`[scheduler] firing "${label}" -> conv ${convId} (${freshThread ? 'fresh' : 'reused'}${isHeadless(sender) ? ', no window' : ''})`)
    startTurn(sender, {
      conversationId: convId,
      text: prompt,
      defaultProvider: s.provider,
      cwd: project.folderPath ?? undefined,
      permissionMode: s.permissionMode,
      model: s.model ?? undefined,
      messageMetadata: { scheduled: true }
    }, {
      onFinished: (err) => notify(
        err ? `Workbench · task failed` : `Workbench · task finished`,
        err ? `“${label}” hit an error.` : `“${label}” finished in ${project.name}.`
      )
    })
  } catch (e) {
    logError(`[scheduler] fire failed: ${String(e)}`)
    notify('Workbench · task failed', `“${s.title.trim() || 'Scheduled task'}” couldn't start: ${String((e as Error)?.message ?? e)}`)
  }
}

// A due run within this window of its scheduled time is "on time" and fires. A daily
// run older than this was missed while the app was closed/asleep — skip it to the next
// real slot instead of firing late (B-047). The window covers the 60s tick plus slack
// for a just-woken machine. Interval tasks still catch up (fire once when overdue).
const ON_TIME_GRACE_MS = 5 * 60_000
function tick(): void {
  const now = Date.now()
  for (const s of listDue(now)) {
    if (s.kind === 'daily' && now - s.nextRunAt > ON_TIME_GRACE_MS) {
      advanceNextRun(s.id, now) // missed slot → next scheduled time, no late fire
      const label = s.title.trim() || 'Scheduled task'
      const due = new Date(s.nextRunAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      logInfo(`[scheduler] skipped missed daily "${label}" (was due ${due})`)
      // D-084 #3: say so instead of skipping silently (the Mac was off or asleep at the time).
      notify('Workbench · run missed', `“${label}” was due ${due} while Troupe wasn't running. It runs at the next scheduled time.`)
      continue
    }
    fire(s)
  }
}

export function startScheduler(): void {
  if (timer) return
  tick() // catch up anything already due (missed while the app was closed)
  timer = setInterval(tick, 60_000)
  logInfo('[scheduler] started (60s tick)')
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
}

// Fire immediately, off-schedule (for a "Run now" button).
export function runScheduleNow(s: Schedule): void { fire(s) }
