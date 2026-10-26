// `troupe schedules …` (D-118 list/run; D-134 add, show, edit, pause, resume, delete).
// Rules (shared/scheduleRules.ts): a task a bot makes starts paused until you approve it in
// Tasks; bots edit and delete only tasks handed over to them; never Full access or a higher
// mode; on a Full-access task an edit or delete waits for you. Every change is logged.
import { getProject } from '../projects/projectsRepo'
import { listConversations } from '../conversations/conversationsRepo'
import { lastUserTurn } from '../conversations/messagesRepo'
import { listSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule, setPending, countCliSchedules } from '../schedules/schedulesRepo'
import { runScheduleNow } from '../schedules/scheduler'
import { broadcastSchedulesChanged } from '../schedules/scheduleChanges'
import { logInfo } from '../util/logger'
import { CliError, pickOne, parseMode, encodeRunId, schedulesText, scheduleText, describeSchedule, type CliSchedule } from '../../shared/cliProtocol'
import { planEdit, planDelete, checkRunnable, parseDaily, parseEvery, RuleError, CLI_SCHEDULE_MAX, describeChange } from '../../shared/scheduleRules'
import type { ProviderId, Schedule, SchedulePatch } from '../../shared/types'

type Params = { get(k: string): string | null }
interface Deps {
  findProject: (q: string) => { id: string; name: string }
  findAgent: (q: string | null, fallback: ProviderId) => ProviderId
  agentName: (id: string | null | undefined) => string
}
interface Result { status: number; json: unknown; text: string }
const ok = (json: unknown, text: string): Result => ({ status: 200, json, text })
const MAX_PROMPT = 20_000

const rule = <T>(f: () => T): T => { try { return f() } catch (e) { if (e instanceof RuleError) throw new CliError(e.message, 403); throw e } }
const toCli = (s: Schedule, d: Deps, withPrompt = false): CliSchedule => ({
  id: s.id, title: s.title || 'Scheduled task', project: getProject(s.projectId)?.name ?? '', agent: d.agentName(s.provider),
  when: describeSchedule(s.kind, s.intervalMin, s.atMin), enabled: s.enabled, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, chat: s.convId,
  mode: s.permissionMode, model: s.model, sameChat: s.target === 'same', createdBy: s.createdVia, managed: s.botManaged,
  waiting: s.pending ? s.pending.kind : null,
  ...(withPrompt ? { prompt: s.botManaged ? s.prompt : null, change: s.pending ? describeChange(s.pending) : [] } : {})
})

/** --daily / --every / --mode / --agent / --model / --title / --prompt / --chat into a patch. */
function readPatch(q: Params, d: Deps, cur: Schedule | null): SchedulePatch {
  const p: SchedulePatch = {}
  const title = q.get('title'); if (title !== null) { if (!title.trim()) throw new CliError('The title is empty.'); p.title = title.trim().slice(0, 120) }
  const prompt = q.get('prompt'); if (prompt !== null) {
    if (!prompt.trim()) throw new CliError('The prompt is empty.')
    if (prompt.length > MAX_PROMPT) throw new CliError(`The prompt is longer than ${MAX_PROMPT} characters.`)
    p.prompt = prompt
  }
  const daily = q.get('daily'); const every = q.get('every')
  if (daily && every) throw new CliError('Use --daily or --every, not both.')
  if (daily) { p.kind = 'daily'; p.atMin = rule(() => parseDaily(daily)) }
  if (every) { p.kind = 'interval'; p.intervalMin = rule(() => parseEvery(every)) }
  if (q.get('mode') !== null) p.permissionMode = parseMode(q.get('mode'))
  if (q.get('agent') !== null) p.provider = d.findAgent(q.get('agent'), cur?.provider ?? 'claude-code')
  if (q.get('model') !== null) p.model = q.get('model')!.trim() || null
  const chat = q.get('chat'); if (chat !== null) {
    if (chat !== 'same' && chat !== 'new') throw new CliError('Use --same-chat or --new-chat.')
    p.target = chat
  }
  return p
}

const findTask = (q: Params) => pickOne(listSchedules(), q.get('task') ?? '', (x) => x.title, 'scheduled task')

export function runScheduleCommand(q: Params, d: Deps): Result {
  const op = q.get('do') ?? 'list'
  switch (op) {
    case 'list': {
      const list = listSchedules().map((s) => toCli(s, d))
      return ok(list, schedulesText(list))
    }
    case 'show': {
      const s = findTask(q)
      const c = toCli(s, d, true)
      return ok(c, scheduleText(c))
    }
    case 'run': {
      const s = findTask(q)
      rule(() => checkRunnable(s, 'run'))
      const before = Date.now()
      runScheduleNow(getSchedule(s.id) ?? s)
      const chat = listConversations(s.projectId).filter((c) => c.updatedAt >= before).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      const sent = chat ? lastUserTurn(chat.id).user : null
      const run = chat && sent && sent.createdAt >= before ? encodeRunId(chat.id, sent.createdAt) : null
      logInfo('[cli] schedule run', { task: s.id })
      return ok({ task: s.id, run, chat: chat?.id ?? null }, run ? `Started "${s.title}".\nrun ${run}\nCheck with: troupe status ${run} --wait 600` : `Asked "${s.title}" to run; it didn't start (its agent may be off or its chat busy). See troupe runs.`)
    }
    case 'pause': case 'resume': {
      const s = findTask(q)
      if (op === 'resume') rule(() => checkRunnable(s, 'resume'))
      const u = updateSchedule(s.id, { enabled: op === 'resume' })!
      logInfo(`[cli] schedule ${op}`, { task: s.id })
      broadcastSchedulesChanged()
      return ok(toCli(u, d), `${op === 'pause' ? 'Paused' : 'Resumed'} "${u.title}".${u.enabled ? ` Next run ${describeSchedule(u.kind, u.intervalMin, u.atMin)}.` : ''}`)
    }
    case 'add': {
      const project = d.findProject(q.get('project') ?? '')
      if (countCliSchedules() >= CLI_SCHEDULE_MAX) throw new CliError(`There are already ${CLI_SCHEDULE_MAX} tasks made from the command line. Delete one first.`, 403)
      const p = readPatch(q, d, null)
      if (!p.title) throw new CliError('Give the task a title: troupe schedules add <project> "<title>" --prompt "…" --daily 08:30')
      if (!p.prompt) throw new CliError('Give the task a prompt: --prompt "…" (or --prompt - to read it from stdin).')
      if (!p.kind) throw new CliError('Say when it runs: --daily 08:30 or --every 2h.')
      const s = createSchedule({
        projectId: project.id, title: p.title, prompt: p.prompt, provider: p.provider ?? d.findAgent(null, 'claude-code'), model: p.model ?? null,
        permissionMode: p.permissionMode ?? 'auto', kind: p.kind, intervalMin: p.intervalMin, atMin: p.atMin, target: p.target ?? 'new',
        createdVia: 'cli', botManaged: true, enabled: false, pending: { kind: 'new', at: Date.now() }
      })
      logInfo('[cli] schedule add', { task: s.id, project: project.id, kind: s.kind, mode: s.permissionMode })
      broadcastSchedulesChanged()
      return ok(toCli(s, d), `Created "${s.title}" in ${project.name} — ${describeSchedule(s.kind, s.intervalMin, s.atMin)}, ${d.agentName(s.provider)}.\nIt is paused until you approve it in Troupe ▸ Tasks.\ntask ${s.id}`)
    }
    case 'edit': {
      const s = findTask(q)
      const patch = readPatch(q, d, s)
      const plan = rule(() => planEdit(s, patch))
      if ('pending' in plan) {
        setPending(s.id, plan.pending); updateSchedule(s.id, { enabled: false })
        logInfo('[cli] schedule edit (waits for approval)', { task: s.id, fields: Object.keys(patch) })
        broadcastSchedulesChanged()
        return ok({ ...toCli(getSchedule(s.id)!, d), change: describeChange(plan.pending) }, `"${s.title}" runs in Full access, so this change waits for approval in Troupe ▸ Tasks. The task is paused until then.\n${describeChange(plan.pending).map((l) => `  ${l}`).join('\n')}`)
      }
      const u = updateSchedule(s.id, plan.apply)!
      logInfo('[cli] schedule edit', { task: s.id, fields: Object.keys(plan.apply) })
      broadcastSchedulesChanged()
      return ok(toCli(u, d), `Updated "${u.title}".`)
    }
    case 'delete': {
      const s = findTask(q)
      const plan = rule(() => planDelete(s))
      if ('pending' in plan) {
        setPending(s.id, plan.pending); updateSchedule(s.id, { enabled: false })
        logInfo('[cli] schedule delete (waits for approval)', { task: s.id })
        broadcastSchedulesChanged()
        return ok({ task: s.id, deleted: false, waiting: 'delete' }, `"${s.title}" runs in Full access, so deleting it waits for you to confirm in Troupe ▸ Tasks. It is paused until then.`)
      }
      deleteSchedule(s.id)
      logInfo('[cli] schedule delete', { task: s.id })
      broadcastSchedulesChanged()
      return ok({ task: s.id, deleted: true }, `Deleted "${s.title}".`)
    }
    default: throw new CliError(`Unknown schedules command "${op}". Try: troupe --help`, 404)
  }
}
