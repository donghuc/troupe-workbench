// Scheduled tasks from the command line (D-134). A task is a standing instruction that runs
// with nobody watching, so bots get a narrow, predictable set of rules — pure, unit-tested:
//  - a task a bot creates starts paused until you approve it in Tasks (rule 2);
//  - bots edit and delete only tasks handed over to them ("Bots can manage this task" —
//    on for the tasks they made); your other tasks they may only list, run, pause, resume (rule 3);
//  - never Full access, and never a higher mode than the task has;
//  - on a Full-access task a bot's edit (other than lowering the mode) or delete waits for you.
import type { PermissionMode } from './agent'
import type { Schedule, SchedulePatch, SchedulePending } from './types'

const CLI_SCHEDULE_MIN_INTERVAL = 15     // minutes
export const CLI_SCHEDULE_MAX = 20              // tasks made over the command line

const RANK: Record<PermissionMode, number> = { read: 0, auto: 1, full: 2 }
const MODE_WORD: Record<PermissionMode, string> = { read: 'Read-only', auto: 'Auto', full: 'Full access' }

export class RuleError extends Error {}

/** "08:30" → minutes past midnight. */
export function parseDaily(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new RuleError(`Can't read --daily "${v}". Use a time like 08:30.`)
  return Number(m[1]) * 60 + Number(m[2])
}
/** "90m", "2h", "45" (minutes) → minutes; at least every 15 minutes. */
export function parseEvery(v: string): number {
  const m = /^(\d+)\s*(m|min|h)?$/i.exec(v.trim())
  if (!m) throw new RuleError(`Can't read --every "${v}". Use 30m, 2h or a number of minutes.`)
  const min = Number(m[1]) * (m[2]?.toLowerCase() === 'h' ? 60 : 1)
  if (min < CLI_SCHEDULE_MIN_INTERVAL) throw new RuleError(`Tasks from the command line run at most every ${CLI_SCHEDULE_MIN_INTERVAL} minutes.`)
  if (min > 7 * 24 * 60) throw new RuleError('At most every 168 h (a week). For once a day, use --daily 08:30.')
  return min
}

const notHandedOver = (s: Schedule) => new RuleError(`"${s.title || 'This task'}" isn't handed over to bots. In Troupe ▸ Tasks, turn on "Bots can manage this task" first — or list, run, pause and resume it as it is.`)
const waiting = (s: Schedule) => new RuleError(`"${s.title || 'This task'}" has a change waiting for approval in Troupe ▸ Tasks.`)

/** Run now / resume: not while it waits for approval (a new task, or an edit to a Full-access task). */
export function checkRunnable(s: Schedule, what: 'run' | 'resume'): void {
  if (!s.pending) return
  if (s.pending.kind === 'new') throw new RuleError(`"${s.title || 'This task'}" was made from the command line and waits for approval in Troupe ▸ Tasks before it can ${what === 'run' ? 'run' : 'be turned on'}.`)
  throw waiting(s)
}

export type EditPlan = { apply: SchedulePatch } | { pending: SchedulePending }

/** What happens to a bot's edit. Throws RuleError when it isn't allowed. */
export function planEdit(s: Schedule, patch: SchedulePatch, now = Date.now()): EditPlan {
  if (!s.botManaged) throw notHandedOver(s)
  if (s.pending) throw waiting(s)
  const keys = (Object.keys(patch) as (keyof SchedulePatch)[]).filter((k) => patch[k] !== undefined)
  if (!keys.length) throw new RuleError('Nothing to change. Use --title, --prompt, --daily, --every, --agent, --model, --mode or --same-chat / --new-chat.')
  if (patch.permissionMode) {
    if (patch.permissionMode === 'full') throw new RuleError('Full access is not available from the command line.')
    if (RANK[patch.permissionMode] > RANK[s.permissionMode]) throw new RuleError(`Only you can raise a task's mode (it is ${MODE_WORD[s.permissionMode]}). Change it in Troupe ▸ Tasks.`)
  }
  if (patch.enabled !== undefined) throw new RuleError('Use troupe schedules pause / resume.')
  // A Full-access task runs unwatched with no limits: anything but lowering its mode waits for you.
  if (s.permissionMode === 'full' && keys.some((k) => k !== 'permissionMode')) {
    const before: SchedulePatch = {}
    for (const k of keys) (before as Record<string, unknown>)[k] = (s as unknown as Record<string, unknown>)[k]
    return { pending: { kind: 'edit', at: now, patch, before, wasEnabled: s.enabled } }
  }
  return { apply: patch }
}

export type DeletePlan = { delete: true } | { pending: SchedulePending }
export function planDelete(s: Schedule, now = Date.now()): DeletePlan {
  if (!s.botManaged) throw notHandedOver(s)
  if (s.pending?.kind === 'new') return { delete: true }        // a bot discarding its own unapproved task
  if (s.pending) throw waiting(s)
  if (s.permissionMode === 'full') return { pending: { kind: 'delete', at: now, wasEnabled: s.enabled } }
  return { delete: true }
}

/** What Approve / Discard in Tasks does to a waiting change. */
export type ReviewAction =
  | { op: 'enable' } | { op: 'delete' }
  | { op: 'update'; patch: SchedulePatch }
  | { op: 'restore'; enabled: boolean }
export function reviewAction(p: SchedulePending, approve: boolean): ReviewAction {
  if (p.kind === 'new') return approve ? { op: 'enable' } : { op: 'delete' }
  if (p.kind === 'delete') return approve ? { op: 'delete' } : { op: 'restore', enabled: p.wasEnabled ?? true }
  return approve ? { op: 'update', patch: { ...(p.patch ?? {}), enabled: p.wasEnabled ?? true } } : { op: 'restore', enabled: p.wasEnabled ?? true }
}

/** "prompt: “old…” → “new…”" lines for a waiting edit. */
export function describeChange(p: SchedulePending): string[] {
  if (p.kind !== 'edit') return []
  const show = (k: string, v: unknown): string => {
    if (v === undefined || v === null || v === '') return '—'
    if (k === 'atMin' && typeof v === 'number') return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
    if (k === 'permissionMode') return MODE_WORD[v as PermissionMode] ?? String(v)
    if (k === 'target') return v === 'same' ? 'same chat' : 'new chat each run'
    const t = String(v).replace(/\s+/g, ' ').trim()
    return `“${t.length > 80 ? t.slice(0, 77) + '…' : t}”`
  }
  const label: Record<string, string> = { title: 'Title', prompt: 'Prompt', provider: 'Agent', model: 'Model', permissionMode: 'Mode', kind: 'Repeats', intervalMin: 'Every (min)', atMin: 'At', target: 'Chat' }
  return Object.keys(p.patch ?? {}).map((k) => `${label[k] ?? k}: ${show(k, (p.before as Record<string, unknown> | undefined)?.[k])} → ${show(k, (p.patch as Record<string, unknown>)[k])}`)
}
