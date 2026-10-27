// Collab runtime (audit #12, 2026-10-27): what every role's launch shares — the run → agent-run
// map, the window to stream to, the chat lock and how its hold ends, the change broadcast, the
// error guard and the per-role deadlines. Split out of orchestrator.ts, behaviour unchanged.
import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import { runTimeoutMs, startRun, type RunParams } from '../agent/runner'
import { acquireLock, releaseLock } from '../agent/turns'
import { senderForRun } from '../agent/headless'
import type { TurnOutcome } from '../../shared/turnQueue'
import { logError } from '../util/logger'
import type { CollabRun, CollabChanged, CollabTask } from '../../shared/types'
import { getCollabRunBare, updateCollabRun, bumpRuns } from './collabRepo'

export const SK_PROTOCOL = 'global/collab-protocol'

export const SK_PLANNER = 'global/role-planner'

export const SK_MAKER = 'global/role-maker'

export const SK_REVIEWER = 'global/role-reviewer'

// The active provider run id per collab run, so a stop can cancel it.
export const activeRunId = new Map<string, string>()

// The renderer that started/confirmed a run, for streaming; falls back to first window.
export const senderFor = new Map<string, WebContents>()

export function wc(runId: string): WebContents | null {
  const s = senderFor.get(runId)
  if (s && !s.isDestroyed()) return s
  // Audit #15: with no window open (a bot driving Collab from the command line), run headless
  // like chat turns do — this used to fail with "No app window to run in."
  return senderForRun()
}

// D-061: while a collab agent works, the conversation is locked like a chat turn.
const holder = (runId: string): string => `collab:${runId}`

export function lockFor(run: CollabRun): boolean { return acquireLock(run.conversationId, holder(run.id)) }

// P0-3 (audit 2026-10-26): say how the run's hold ended, so the chat's queue pauses after a Stop
// or failure and waits while the run waits for you (plan to approve, needs attention).
export function unlockFor(run: { id: string; conversationId: string }, outcome: TurnOutcome = 'done'): void { releaseLock(run.conversationId, holder(run.id), outcome) }

// P0-1: an error while handling an agent's finish used to vanish (the runner swallows it) and
// leave the run "running" with the chat locked. Now it is logged and the run pauses, which
// unlocks the chat; Resume picks it up again.
function guarded<A extends unknown[]>(runId: string, what: string, fn: (...a: A) => void): (...a: A) => void {
  return (...a: A) => {
    try { fn(...a) } catch (e) {
      logError(`[collab] ${what} failed`, { run: runId, err: String((e as Error)?.stack ?? e) })
      try { pause(runId, `Troupe hit an error after the ${what} finished (${String((e as Error)?.message ?? e).slice(0, 160)}). Resume to carry on.`) } catch (e2) {
        // Even the pause failed (database trouble): at least give the chat back.
        logError('[collab] pause after error failed', { run: runId, err: String(e2) })
        const r = getCollabRunBare(runId); if (r) unlockFor(r, 'error')
        emitChanged(runId)
      }
    }
  }
}

// Audit #10 (2026-10-26): say which run changed, so each open chat only reloads for its own run
// (every change used to make every open chat re-fetch its whole transcript).
export function emitChanged(runId: string): void {
  const run = getCollabRunBare(runId)
  const payload: CollabChanged = { runId, conversationId: run?.conversationId ?? null }
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(IPC.collabChanged, payload) }
}

// D-121: every Collab agent reply is tagged, so the chat shows it as one line (expandable)
// instead of the full text, and the Done card can sit after the run's last message.
type CollabRole = 'planner' | 'maker' | 'reviewer' | 'repair' | 'wrapup'

const tag = (runId: string, role: CollabRole, task?: CollabTask): Record<string, unknown> =>
  ({ collab: { runId, role, ...(task ? { task: task.seq + 1, title: task.title } : {}) } })

// D-121: per-role deadlines (were all 3× the run timeout — 45 min by default — so a hung
// agent stalled a run for most of an hour). Makers get the most; checks and summaries less.
const ROLE_TIMEOUT: Record<CollabRole, number> = { planner: 1.5, maker: 2, reviewer: 1, repair: 1, wrapup: 1 }

const timeoutFor = (role: CollabRole): number => Math.round(runTimeoutMs() * ROLE_TIMEOUT[role])

export function today(): string { return new Date().toISOString().slice(0, 10) }

export function pause(runId: string, reason: string): void {
  const r = updateCollabRun(runId, { status: 'needs_attention', reason })
  if (r) unlockFor(r, 'waiting')   // the run isn't over: queued messages wait for Resume / Stop
  emitChanged(runId)
}

/** The app's own one-line result (D-121) — plain text for the Done card; the wrap-up tells the story. */

// ── starting a role's agent run (audit #12) ───────────────────────────────────
// Planner, Maker, Reviewer, repair and wrap-up each repeated lock → window → budget → start →
// remember, with different failure paths — which is where the chat-lock leaks of audit P0-1 came
// from. Now: claimFor() takes the chat (or pauses the run, which gives it back), launchRole() starts.

const BUSY = 'This conversation is busy with another turn. Resume when it finishes.'

/** Take the chat for a role's next agent run. Null when it can't: the run is paused with why. */
export function claimFor(run: CollabRun): WebContents | null {
  if (!lockFor(run)) { pause(run.id, BUSY); return null }
  const sender = wc(run.id)
  if (!sender) { pause(run.id, 'No app window to run in.'); return null }
  return sender
}

type RoleParams = Omit<RunParams, 'conversationId' | 'cwd' | 'timeoutMs' | 'parallelGroup' | 'extraMetadata' | 'noConversationContext' | 'onDone' | 'onEvent'>
interface Launch {
  role: CollabRole
  /** Messages in one group show as one block in the chat. */
  group: 'planner' | 'maker' | 'reviewer'
  task?: CollabTask
  /** For the log and the pause reason when its finish handler throws ("Maker", "Reviewer"…). */
  label: string
  retry?: boolean
  /** Remember it as the run's current agent run, so Stop cancels it (default true). */
  track?: boolean
  params: RoleParams
  onDone: (messageId: string | null, err?: string) => void
  /** false: the caller guards its own finish handler (the wrap-up releases the chat itself). */
  guard?: boolean
}

/** Start a role's agent run on a claimed chat: counted against the budget, its deadline by role,
 *  tagged for the chat, its finish guarded. Null when it couldn't start — the run is paused. */
export function launchRole(run: CollabRun, sender: WebContents, o: Launch): string | null {
  bumpRuns(run.id, o.retry === undefined ? undefined : { retry: o.retry })
  try {
    const rid = startRun(sender, {
      ...o.params,
      conversationId: run.conversationId, cwd: run.projectCwd, timeoutMs: timeoutFor(o.role),
      noConversationContext: true, parallelGroup: `collab:${run.id}:${o.group}`, extraMetadata: tag(run.id, o.role, o.task),
      onDone: o.guard === false ? o.onDone : guarded(run.id, o.label, o.onDone)
    })
    if (o.track !== false) activeRunId.set(run.id, rid)
    return rid
  } catch (e) {
    logError(`[collab] could not start the ${o.label}`, { run: run.id, err: String((e as Error)?.stack ?? e) })
    pause(run.id, `Couldn't start the ${o.label} (${String((e as Error)?.message ?? e).slice(0, 160)}). Resume to try again.`)
    return null
  }
}

/** The loop's entry points for recovery.ts, which the loop also calls into: set once by
 *  orchestrator.ts when it loads (a direct import would be a cycle). */
export const loop = {
  step: (_runId: string): void => { throw new Error('Collab loop not loaded') },
  runMaker: (_runId: string, _taskId: string): void => { throw new Error('Collab loop not loaded') },
  runReviewer: (_runId: string, _taskId: string, _isFinal: boolean): void => { throw new Error('Collab loop not loaded') }
}
