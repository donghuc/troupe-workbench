import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import type { Schedule, NewScheduleInput, SchedulePatch, ScheduleKind, SchedulePending } from '../../shared/types'
import { computeNext } from './nextRun'

interface Row {
  id: string; project_id: string; title: string; prompt: string; provider: string
  model: string | null; permission_mode: string; kind: string; interval_min: number
  at_min: number; enabled: number; next_run_at: number; last_run_at: number | null; created_at: number
  target: string; conv_id: string | null
  created_via?: string; bot_managed?: number; pending?: string | null
}

const readPending = (raw: string | null | undefined): SchedulePending | null => {
  if (!raw) return null
  try { const p = JSON.parse(raw); return p && ['new', 'edit', 'delete'].includes(p.kind) ? p as SchedulePending : null } catch { return null }
}

const toSchedule = (r: Row): Schedule => ({
  id: r.id, projectId: r.project_id, title: r.title, prompt: r.prompt,
  provider: r.provider as Schedule['provider'], model: r.model,
  permissionMode: r.permission_mode as Schedule['permissionMode'],
  kind: r.kind as ScheduleKind, intervalMin: r.interval_min, atMin: r.at_min,
  target: (r.target as Schedule['target']) ?? 'new', convId: r.conv_id,
  enabled: !!r.enabled, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, createdAt: r.created_at,
  createdVia: r.created_via === 'cli' ? 'cli' : 'app', botManaged: !!r.bot_managed, pending: readPending(r.pending)
})

export function listSchedules(): Schedule[] {
  return (getDb().prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as Row[]).map(toSchedule)
}
export function getSchedule(id: string): Schedule | null {
  const r = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined
  return r ? toSchedule(r) : null
}
// The schedule that owns a reused thread (target 'same'), if any — used to pin its
// instruction into that thread's context (D-084).
export function getScheduleByConv(convId: string): Schedule | null {
  const r = getDb().prepare('SELECT * FROM schedules WHERE conv_id = ? LIMIT 1').get(convId) as Row | undefined
  return r ? toSchedule(r) : null
}
export function listDue(now: number): Schedule[] {
  return (getDb().prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC').all(now) as Row[]).map(toSchedule)
}

export function createSchedule(input: NewScheduleInput): Schedule {
  const now = Date.now(); const id = randomUUID()
  const kind = input.kind
  const intervalMin = input.intervalMin ?? 60
  const atMin = input.atMin ?? 540
  const nextRunAt = computeNext(kind, intervalMin, atMin, now)
  getDb().prepare(
    `INSERT INTO schedules (id, project_id, title, prompt, provider, model, permission_mode, kind, interval_min, at_min, target, conv_id, enabled, next_run_at, last_run_at, created_at, created_via, bot_managed, pending)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(id, input.projectId, input.title.trim(), input.prompt, input.provider, input.model ?? null,
        input.permissionMode ?? 'auto', kind, intervalMin, atMin, input.target ?? 'new', input.enabled === false ? 0 : 1, nextRunAt, now,
        input.createdVia ?? 'app', input.botManaged ? 1 : 0, input.pending ? JSON.stringify(input.pending) : null)
  return getSchedule(id)!
}

export function updateSchedule(id: string, patch: SchedulePatch): Schedule | null {
  const cur = getSchedule(id)
  if (!cur) return null
  const next = { ...cur, ...patch }
  // The form sends intervalMin/atMin as undefined for the non-applicable kind; a bare
  // spread would clobber the stored value with undefined and crash the bind. Keep the
  // current value when the patch omits one (matches createSchedule's ?? defaults).
  const intervalMin = patch.intervalMin ?? cur.intervalMin ?? 60
  const atMin = patch.atMin ?? cur.atMin ?? 540
  // Recompute nextRunAt when timing/enabled changes.
  const timingChanged = patch.kind !== undefined || patch.intervalMin !== undefined || patch.atMin !== undefined || patch.enabled === true
  const nextRunAt = timingChanged ? computeNext(next.kind, intervalMin, atMin, Date.now()) : cur.nextRunAt
  getDb().prepare(
    `UPDATE schedules SET title=?, prompt=?, provider=?, model=?, permission_mode=?, kind=?, interval_min=?, at_min=?, target=?, enabled=?, next_run_at=? WHERE id=?`
  ).run(next.title, next.prompt, next.provider, next.model ?? null, next.permissionMode, next.kind,
        intervalMin, atMin, next.target, next.enabled ? 1 : 0, nextRunAt, id)
  return getSchedule(id)
}

// Advance nextRunAt after a fire, stamping lastRunAt.
export function markRan(id: string, ranAt: number): void {
  const s = getSchedule(id)
  if (!s) return
  const nextRunAt = computeNext(s.kind, s.intervalMin, s.atMin, ranAt)
  getDb().prepare('UPDATE schedules SET last_run_at=?, next_run_at=? WHERE id=?').run(ranAt, nextRunAt, id)
}

// Advance nextRunAt to the next future slot WITHOUT recording a run — used to skip a
// daily slot that was missed while the app was closed/asleep, so it doesn't fire late
// (B-047). Unlike markRan, it leaves last_run_at untouched (nothing actually ran).
export function advanceNextRun(id: string, from: number): void {
  const s = getSchedule(id)
  if (!s) return
  const nextRunAt = computeNext(s.kind, s.intervalMin, s.atMin, from)
  getDb().prepare('UPDATE schedules SET next_run_at=? WHERE id=?').run(nextRunAt, id)
}

export function setScheduleConv(id: string, convId: string): void {
  getDb().prepare('UPDATE schedules SET conv_id=? WHERE id=?').run(convId, id)
}

/** D-134: "Bots can manage this task". */
export function setBotManaged(id: string, on: boolean): void {
  getDb().prepare('UPDATE schedules SET bot_managed=? WHERE id=?').run(on ? 1 : 0, id)
}
/** D-134: a bot's change waiting for approval (null clears it). */
export function setPending(id: string, pending: SchedulePending | null): void {
  getDb().prepare('UPDATE schedules SET pending=? WHERE id=?').run(pending ? JSON.stringify(pending) : null, id)
}
/** Tasks made over the command line (for the limit). */
export function countCliSchedules(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM schedules WHERE created_via = 'cli'").get() as { n: number }).n
}

export function deleteSchedule(id: string): void {
  getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id)
}
