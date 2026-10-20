// Collab checks and helpers (D-121, from the 2026-10-20 Collab audit). Pure: the orchestrator,
// the Collab card and the CLI use them; tested on their own.
import type { CollabTaskKind, CollabTry } from './types'
import { scopePaths } from './collabFiles'

interface PlanTask { title: string; kind: CollabTaskKind; scope: string; dependsOn: string[]; id?: string }

/**
 * Agent runs a plan needs, with room for one retry per task, a couple of Planner fixes and
 * the wrap-up — instead of a flat 24 whatever the plan's size. Never below the old default.
 */
export function planBudget(tasks: { kind: CollabTaskKind }[], maxRetriesPerTask: number, floor = 24): number {
  const work = tasks.filter((t) => t.kind !== 'review').length
  const review = tasks.length - work
  const perWork = 2 * (1 + Math.max(0, maxRetriesPerTask))   // Maker + Reviewer, per attempt
  const need = 1 /* planner */ + work * perWork + review * 2 + 2 /* repairs */ + 1 /* wrap-up */
  return Math.max(floor, need)
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

/**
 * What to check before the user approves a plan: outputs that would land outside the
 * deliverables folder (test 2: a bare `quiz.md` in the project root), two tasks writing the
 * same file, a work task that names nothing it produces, a task reading another task's
 * output without waiting for it, and no final review. `exists` says whether a path is
 * already in the project (editing an existing file outside the folder is fine).
 */
export function planIssues(tasks: PlanTask[], outputDir: string, exists: (rel: string) => boolean = () => false): string[] {
  const issues: string[] = []
  const out = norm(outputDir)
  const owner = new Map<string, number>()
  tasks.forEach((t, i) => {
    const n = `Task ${i + 1}`
    if (t.kind === 'review') return
    const { outputs, inputs } = scopePaths(t.scope ?? '')
    if (!outputs.length) issues.push(`${n} (“${t.title}”) doesn't name a file or folder it produces, so nothing can check it was written.`)
    for (const raw of outputs) {
      const p = norm(raw)
      if (out && !(p === out || p.startsWith(out + '/')) && !exists(p)) {
        issues.push(`${n} writes \`${raw}\` outside the deliverables folder \`${out}/\`${p.includes('/') ? '' : ' — in the project root'}. Put it under \`${out}/\` unless that's intended.`)
      }
      const prev = owner.get(p)
      if (prev !== undefined) issues.push(`Tasks ${prev + 1} and ${i + 1} both write \`${raw}\` — the second would overwrite the first.`)
      else owner.set(p, i)
    }
    for (const raw of inputs) {
      const from = owner.get(norm(raw))
      if (from === undefined || from === i) continue
      const dep = tasks[from]
      if (!t.dependsOn.includes(dep.id ?? String(from))) issues.push(`${n} reads \`${raw}\` from task ${from + 1} but doesn't wait for it.`)
    }
  })
  if (tasks.length && !tasks.some((t) => t.kind === 'review')) issues.push('There is no final review task, so nobody checks the whole result against the goal.')
  return issues
}

export interface WrapUp { outcome: string; decisions: string[]; followUps: string[] }

/**
 * The Planner's wrap-up, read from its markdown: "## Outcome", "## Decisions for you",
 * "## Follow-ups" (headings matched loosely). `outcome` is the first paragraph under Outcome.
 */
export function parseWrapUp(text: string): WrapUp {
  const sections = new Map<string, string[]>()
  let cur = ''
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.+?)\s*$/.exec(line)
    if (h) { cur = h[1].toLowerCase(); sections.set(cur, []); continue }
    if (cur) sections.get(cur)!.push(line)
  }
  const find = (re: RegExp) => [...sections.entries()].find(([k]) => re.test(k))?.[1] ?? []
  const bullets = (lines: string[]) => lines.map((l) => /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x && !/^(none|nothing|n\/a)\.?$/i.test(x))
  const outcomeLines = find(/outcome|result|summary/)
  const para: string[] = []
  for (const l of outcomeLines) { if (!l.trim()) { if (para.length) break; continue } para.push(l.trim()) }
  return { outcome: para.join(' ').replace(/^[-*]\s+/, '').slice(0, 600), decisions: bullets(find(/decision/)), followUps: bullets(find(/follow/)) }
}

/** "4 min 05 s" / "52 s" for task timings. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/**
 * Every attempt at a task in order (D-121) — "Grok failed (…), Grok failed (…), Claude passed".
 * `attempts` resets when a task is reassigned or redone; this record doesn't, so the wrap-up
 * and `collab status` can tell what really happened.
 */
export function triesText(tries: CollabTry[] | undefined, label: (agent: string) => string, withWhy = true): string {
  return (tries ?? []).map((t) => {
    const r = t.result ?? 'in progress'
    const why = withWhy && t.why && t.result !== 'passed' ? ` (${t.why.length > 140 ? t.why.slice(0, 140) + '…' : t.why})` : ''
    return `${label(t.agent)} ${r}${why}`
  }).join(', ')
}
