// Pure Collab recovery logic (D-109): spotting a task that keeps failing the same way,
// and reading a Planner "repair" proposal. Used by the orchestrator; tested on its own.
import type { CollabRepair, CollabRepairOption, ProviderId } from './types'

// Words that say nothing about WHY a task failed (reviewers' boilerplate).
const NOISE = new Set(['blocking', 'escalation', 'finding', 'findings', 'acceptance', 'criteria', 'criterion', 'task', 'maker', 'reviewer',
  'should', 'would', 'could', 'must', 'does', 'have', 'with', 'that', 'this', 'from', 'into', 'only', 'then', 'than', 'they', 'their',
  'there', 'which', 'when', 'what', 'were', 'been', 'being', 'also', 'still', 'again', 'because', 'about', 'every', 'none', 'once',
  'line', 'file', 'files', 'here', 'just', 'like', 'make', 'made', 'more', 'most', 'other', 'some', 'such', 'will', 'your', 'needs', 'need'])

/**
 * The gist of a failure as a set of meaningful words (D-109, revised D-111). Reviewers word
 * the same failure differently every time ("Source missing: README.md…" vs "Blocking — README.md
 * does not exist…"), so failures are compared by overlap of these words, not by exact text.
 */
export function failSig(findings: string[]): string {
  const words = findings.join(' ').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`'"“”‘’]/g, ' ')
    .replace(/[^a-z0-9._/-]+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^[._/-]+|[._/-]+$/g, ''))
    .filter((w) => w.length > 3 && !NOISE.has(w) && !/^\d+$/.test(w))
  return [...new Set(words)].sort().slice(0, 80).join(' ')
}

/**
 * Overlap of two signatures, 0–1: shared words / words in the SHORTER one. A terse app
 * check ("Deliverable missing: x.md") and a long review of the same problem still match;
 * Jaccard would punish the long one for its extra detail.
 */
function sigSimilarity(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let both = 0
  for (const w of A) if (B.has(w)) both++
  return both / Math.min(A.size, B.size)
}
/** Failures this similar count as "the same failure again". */
const SAME_FAILURE = 0.45

/** Same failure as last time → how many in a row now (1 when it differs). */
export function nextSameFails(prevSig: string | undefined, prevCount: number | undefined, sig: string): number {
  return prevSig && sig && sigSimilarity(prevSig, sig) >= SAME_FAILURE ? (prevCount ?? 1) + 1 : 1
}

/** A task is stuck when the same failure came back this many times in a row. */
export const STALL_AFTER = 2

const ACTIONS = new Set(['retry', 'reassign', 'rewrite', 'skip', 'rework'])

/** Validate a Planner repair reply; drops options that can't be applied. */
export function parseRepair(raw: unknown, taskId: string, isAgent: (id: string) => boolean, isWorkTask: (seq: number) => boolean = () => false): CollabRepair | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const options: CollabRepairOption[] = []
  for (const o of Array.isArray(r.options) ? r.options : []) {
    if (!o || typeof o !== 'object') continue
    const x = o as Record<string, unknown>
    const action = String(x.action ?? '')
    if (!ACTIONS.has(action)) continue
    const provider = str(x.provider)
    if (action === 'reassign' && (!provider || !isAgent(provider))) continue
    const opt: CollabRepairOption = {
      label: str(x.label) ?? action,
      action: action as CollabRepairOption['action'],
      changesGoal: x.changesGoal === true,
      ...(provider && isAgent(provider) ? { provider: provider as ProviderId } : {}),
      ...(str(x.title) ? { title: str(x.title) } : {}),
      ...(str(x.scope) ? { scope: str(x.scope) } : {}),
      ...(str(x.acceptance) ? { acceptance: str(x.acceptance) } : {}),
      ...(str(x.note) ? { note: str(x.note) } : {}),
      ...(str(x.userStep) ? { userStep: str(x.userStep) } : {}),
      ...(str(x.goal) ? { goal: str(x.goal) } : {})
    }
    // D-121: 'rework' names a work task by its 1-based plan number (final review fixes only)
    if (opt.action === 'rework') {
      const n = Number(x.task)
      if (!Number.isInteger(n) || !isWorkTask(n - 1)) continue
      opt.taskSeq = n - 1
    }
    // a corrected goal always changes what the run delivers
    if (opt.goal) opt.changesGoal = true
    if (opt.action === 'rewrite' && !opt.title && !opt.scope && !opt.acceptance && !opt.provider) continue
    // skipping a task always changes what the run delivers — never auto-apply it
    if (opt.action === 'skip') opt.changesGoal = true
    options.push(opt)
    if (options.length >= 3) break
  }
  if (!options.length) return null
  const rec = Number(r.recommended)
  return {
    taskId,
    summary: str(r.summary) ?? 'The task keeps failing the same way.',
    options,
    recommended: Number.isInteger(rec) && rec >= 0 && rec < options.length ? rec : 0
  }
}

/** D-121: an agent's reply saying a headless run stopped at a permission prompt (GrokProvider). */
export const PERMISSION_BLOCKED_RE = /was blocked asking permission for `([^`]+)`/
