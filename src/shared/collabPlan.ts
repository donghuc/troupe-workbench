// Pure Collab plan logic (D-064), shared by the orchestrator and the plan editor.
import type { CollabTask, CollabTaskDraft } from './types'

/** A plan-editor row: a draft plus a stable key so dependencies survive reorder/delete. */
export type PlanRow = CollabTaskDraft & { key: string; dependsOn?: string[] }

/** Rows for the editor from persisted tasks: key = task id, dependsOn = task ids. */
export function rowsFromTasks(tasks: CollabTask[]): PlanRow[] {
  return tasks.map((t) => ({
    key: t.id, title: t.title, kind: t.kind, scope: t.scope, acceptance: t.acceptance,
    provider: t.provider ?? undefined, model: t.model ?? undefined, dependsOn: [...t.dependsOn],
    ...(t.meta?.reviewer ? { reviewer: t.meta.reviewer } : {})
  }))
}

/**
 * Drafts to persist from edited rows. dependsOn keys become current row indices
 * (what replaceTasks resolves); dependencies on deleted rows or on self are dropped.
 */
export function draftsFromRows(rows: PlanRow[]): CollabTaskDraft[] {
  const index = new Map(rows.map((r, i) => [r.key, i]))
  return rows.map((r, i) => {
    const { key: _key, ...rest } = r
    const deps = (r.dependsOn ?? [])
      .map((k) => index.get(k))
      .filter((n): n is number => n !== undefined && n !== i)
    return { ...rest, dependsOn: [...new Set(deps)].map(String) }
  })
}

const isDone = (t: CollabTask): boolean => t.status === 'passed' || t.status === 'skipped'

/**
 * Next task to run, or null. A task waits for its explicit dependencies; a review
 * task additionally waits for every task before it, so a whole-result review never
 * runs over work that has not passed. Unknown dependency ids are treated as missing
 * work, not as satisfied.
 */
export function nextRunnable(tasks: CollabTask[]): CollabTask | null {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const t of tasks) {
    if (t.status !== 'pending') continue
    const depsOk = t.dependsOn.every((d) => { const dep = byId.get(d); return !!dep && isDone(dep) })
    const priorOk = t.kind !== 'review' || tasks.filter((x) => x.seq < t.seq).every(isDone)
    if (depsOk && priorOk) return t
  }
  return null
}

/** Tasks a Resume should put back in the queue: every failed task, with a fresh retry budget. */
export function tasksToRetry(tasks: CollabTask[]): CollabTask[] {
  return tasks.filter((t) => t.status === 'failed')
}

// ── Deliverables folder (D-064) ──────────────────────────────────────────────
// PLAN.md and STATUS.md are app bookkeeping in the hidden .workbench/collab/<run>/.
// Deliverables go to a normal project folder so the file browser and artifact list
// (which hide dot-folders) show them.

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'on', 'in', 'at', 'by', 'with', 'i', 'we', 'you', 'want', 'need', 'please', 'do', 'make', 'before', 'after', 'first', 'continue', 'lets', 'let', 'us', 'our', 'my', 'is', 'are', 'be', 'how', 'what', 'that', 'this', 'it', 'if', 'there'])

/** `collab/<yyyy-mm-dd>-<few goal words>` — fallback when the Planner names nothing usable. */
export function defaultOutputDir(goal: string, createdAt: number): string {
  const date = new Date(createdAt).toISOString().slice(0, 10)
  const words = goal.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).slice(0, 4)
  return `collab/${date}${words.length ? '-' + words.join('-') : ''}`
}

/**
 * A safe project-relative folder, or `fallback`: relative, no `..`, no hidden
 * segment (so never `.workbench/`), trimmed of slashes, at most 4 levels.
 */
export function sanitizeOutputDir(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const segs = raw.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').split('/').filter(Boolean)
  if (!segs.length || segs.length > 4 || raw.trim().startsWith('/') || /^[A-Za-z]:/.test(raw.trim())) return fallback
  if (segs.some((s) => s === '..' || s.startsWith('.') || !/^[\w .-]+$/.test(s))) return fallback
  return segs.join('/')
}

/** Point any path under the run folder (other than PLAN.md / STATUS.md) at the deliverables folder. */
export function retargetScope(scope: string, runDir: string, outDir: string): string {
  if (!scope || !runDir || !outDir) return scope
  const esc = runDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return scope.replace(new RegExp(`(?:\\./)?${esc}/(?!PLAN\\.md|STATUS\\.md)`, 'g'), `${outDir}/`)
}
