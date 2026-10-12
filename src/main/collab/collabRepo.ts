import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import type {
  CollabRun, CollabTask, CollabBudget, CollabSpent, CollabVerdict, CollabHandoff,
  CollabStatus, CollabTaskStatus, CollabTaskKind, CollabTaskDraft, CollabStartInput, ProviderId
} from '../../shared/types'
import { DEFAULT_COLLAB_BUDGET } from '../../shared/types'
import type { PermissionMode } from '../../shared/agent'
import { isProviderId } from '../../shared/providers'

interface RunRow {
  id: string; conversation_id: string; project_cwd: string; provider_id: string
  permission_mode: string; model: string; goal: string; status: string; budget_json: string
  spent_json: string; reason: string; summary: string; created_at: number; updated_at: number
  output_dir?: string
}
interface TaskRow {
  id: string; run_id: string; seq: number; title: string; kind: string; provider: string | null; model: string | null; scope: string
  acceptance: string; depends_on: string; status: string; attempts: number
  last_verdict: string | null; handoff: string | null; maker_run_id: string | null; reviewer_run_id: string | null
}

const parse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

const toRun = (r: RunRow): CollabRun => ({
  id: r.id,
  conversationId: r.conversation_id,
  projectCwd: r.project_cwd,
  providerId: r.provider_id as ProviderId,
  permissionMode: r.permission_mode as PermissionMode,
  model: r.model ?? '',
  goal: r.goal,
  outputDir: r.output_dir ?? '',
  status: r.status as CollabStatus,
  budget: { ...DEFAULT_COLLAB_BUDGET, ...parse<Partial<CollabBudget>>(r.budget_json, {}) },
  spent: parse<CollabSpent>(r.spent_json, { runs: 0 }),
  reason: r.reason,
  summary: r.summary,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toTask = (r: TaskRow): CollabTask => ({
  id: r.id,
  runId: r.run_id,
  seq: r.seq,
  title: r.title,
  kind: r.kind as CollabTaskKind,
  provider: (r.provider as ProviderId | null) ?? null,
  model: r.model,
  scope: r.scope,
  acceptance: r.acceptance,
  dependsOn: parse<string[]>(r.depends_on, []),
  status: r.status as CollabTaskStatus,
  attempts: r.attempts,
  lastVerdict: parse<CollabVerdict | null>(r.last_verdict, null),
  handoff: parse<CollabHandoff | null>(r.handoff, null),
  makerRunId: r.maker_run_id,
  reviewerRunId: r.reviewer_run_id
})

export function createCollabRun(input: CollabStartInput): CollabRun {
  const now = Date.now(); const id = randomUUID()
  const budget: CollabBudget = { ...DEFAULT_COLLAB_BUDGET, ...(input.budget ?? {}) }
  getDb().prepare(
    `INSERT INTO collab_runs (id, conversation_id, project_cwd, provider_id, permission_mode, model, goal, status, budget_json, spent_json, reason, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'planning', ?, ?, '', '', ?, ?)`
  ).run(id, input.conversationId, input.cwd, input.providerId, input.permissionMode ?? 'auto',
        input.model ?? '', input.goal.trim(), JSON.stringify(budget), JSON.stringify({ runs: 0 } as CollabSpent), now, now)
  return getCollabRun(id)!
}

export function getCollabRunBare(id: string): CollabRun | null {
  const r = getDb().prepare('SELECT * FROM collab_runs WHERE id = ?').get(id) as RunRow | undefined
  return r ? toRun(r) : null
}

export function getCollabRun(id: string): CollabRun | null {
  const run = getCollabRunBare(id)
  if (!run) return null
  run.tasks = listTasks(id)
  return run
}

export function listCollabRuns(conversationId: string): CollabRun[] {
  return (getDb().prepare('SELECT * FROM collab_runs WHERE conversation_id = ? ORDER BY created_at DESC')
    .all(conversationId) as RunRow[]).map(toRun)
}

export interface CollabRunPatch {
  status?: CollabStatus
  reason?: string
  summary?: string
  spent?: CollabSpent
  outputDir?: string
}
export function updateCollabRun(id: string, patch: CollabRunPatch): CollabRun | null {
  const cur = getCollabRunBare(id)
  if (!cur) return null
  const next = { ...cur, ...patch }
  getDb().prepare(
    `UPDATE collab_runs SET status = ?, reason = ?, summary = ?, spent_json = ?, output_dir = ?, updated_at = ? WHERE id = ?`
  ).run(next.status, next.reason, next.summary, JSON.stringify(next.spent), next.outputDir ?? '', Date.now(), id)
  return getCollabRun(id)
}

// Add one to the run's spent-runs tally (called before each agent run).
export function bumpRuns(id: string, tokens?: number): CollabRun | null {
  const cur = getCollabRunBare(id)
  if (!cur) return null
  const spent: CollabSpent = { runs: cur.spent.runs + 1, tokens: (cur.spent.tokens ?? 0) + (tokens ?? 0) }
  return updateCollabRun(id, { spent })
}

function listTasks(runId: string): CollabTask[] {
  return (getDb().prepare('SELECT * FROM collab_tasks WHERE run_id = ? ORDER BY seq ASC')
    .all(runId) as TaskRow[]).map(toTask)
}
export function getTask(id: string): CollabTask | null {
  const r = getDb().prepare('SELECT * FROM collab_tasks WHERE id = ?').get(id) as TaskRow | undefined
  return r ? toTask(r) : null
}

// Replace all tasks for a run from drafts (Planner output or user edits before confirm).
// dependsOn entries that are integer indices are resolved to the generated task ids.
export function replaceTasks(runId: string, drafts: CollabTaskDraft[]): CollabTask[] {
  const db = getDb()
  const ids: string[] = drafts.map(() => randomUUID())
  // An index outside the plan, or an id from a previous version of it, is dropped
  // rather than kept as a dangling reference (D-064: unknown deps now block a task).
  const resolveDep = (d: string): string | null => {
    const n = Number(d)
    if (Number.isInteger(n) && n >= 0 && n < ids.length) return ids[n]
    return ids.includes(d) ? d : null
  }
  const okProvider = (p?: string): string | null => (isProviderId(p) ? p : null)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM collab_tasks WHERE run_id = ?').run(runId)
    const ins = db.prepare(
      `INSERT INTO collab_tasks (id, run_id, seq, title, kind, provider, model, scope, acceptance, depends_on, status, attempts, last_verdict, maker_run_id, reviewer_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL)`
    )
    drafts.forEach((d, i) => {
      const deps = (d.dependsOn ?? []).map(resolveDep).filter((x, j, a): x is string => !!x && x !== ids[i] && a.indexOf(x) === j)
      ins.run(ids[i], runId, i, (d.title ?? '').trim() || `Task ${i + 1}`, d.kind ?? 'work',
              okProvider(d.provider), d.model ?? null, d.scope ?? '', d.acceptance ?? '', JSON.stringify(deps))
    })
  })
  tx()
  return listTasks(runId)
}

export interface CollabTaskPatch {
  status?: CollabTaskStatus
  attempts?: number
  lastVerdict?: CollabVerdict | null
  handoff?: CollabHandoff | null
  makerRunId?: string | null
  reviewerRunId?: string | null
}
export function updateTask(id: string, patch: CollabTaskPatch): CollabTask | null {
  const cur = getTask(id)
  if (!cur) return null
  const next = { ...cur, ...patch }
  getDb().prepare(
    `UPDATE collab_tasks SET status = ?, attempts = ?, last_verdict = ?, handoff = ?, maker_run_id = ?, reviewer_run_id = ? WHERE id = ?`
  ).run(next.status, next.attempts, next.lastVerdict ? JSON.stringify(next.lastVerdict) : null,
        next.handoff ? JSON.stringify(next.handoff) : null, next.makerRunId, next.reviewerRunId, id)
  return getTask(id)
}

// D-060 item 4 (audit #8): the orchestrator's in-flight state (active run ids,
// sender) lives in memory, so a run that was planning/running when the app quit
// stays in that status forever and blocks new runs on its conversation. Called
// once at startup, before any window exists: park those runs for the user to
// resume, and put half-done tasks back to pending so `step()` can pick them up.
export function sweepInterruptedRuns(): { runs: number; tasks: number } {
  const db = getDb()
  const reason = 'Interrupted by an app restart. Resume to continue from the last completed task.'
  const runs = db.prepare(
    `UPDATE collab_runs SET status = 'needs_attention', reason = ?, updated_at = ? WHERE status IN ('planning', 'running')`
  ).run(reason, Date.now()).changes
  const tasks = db.prepare(
    `UPDATE collab_tasks SET status = 'pending' WHERE status = 'in_progress'`
  ).run().changes
  return { runs, tasks }
}
