// Check context (D-080 item 3c, D-082): can a fresh chat answer what this project has
// decided? Questions come straight from the decisions log (no agent needed); a fresh
// run with the project's real starting pack answers them; the drafting agent grades.
import type { Outcome } from './decisions'

export interface CheckQuestion { id: string; question: string; expected: string }
export interface CheckResult { id: string; question: string; expected: string; answer: string; ok: boolean; note?: string }

export function checkQuestions(outcomes: Outcome[], max = 6): CheckQuestion[] {
  return outcomes.slice(0, max).map((o) => ({
    id: o.id,
    question: o.kind === 'question' ? `What open question does this project have about: ${o.title}? Is it settled?` : `What did this project ${o.kind === 'decision' ? 'decide' : 'learn'} about: ${o.title}? And why?`,
    expected: [o.title, o.why ? `Why: ${o.why}` : ''].filter(Boolean).join(' — ')
  }))
}

export const answerPrompt = (qs: CheckQuestion[]): string => [
  'Answer each question below from what you already know about this project (its instructions, memory, decisions log and reference files). One or two lines per answer. If you do not know, write exactly "unknown" — do not guess and do not search files for this.',
  '',
  ...qs.map((q, i) => `${i + 1}. ${q.question}`)
].join('\n')

export const gradePrompt = (qs: CheckQuestion[], answers: string): string => [
  'Grade the answers against the expected records. For each numbered question reply whether the answer captures the same decision/insight and its reason (wording may differ). Output ONE JSON array and nothing else: [{"n":1,"ok":true,"note":"…"}, …]. "note" is one short line: what was missing or wrong, or "" when fine. An answer of "unknown" is not ok.',
  '',
  ...qs.map((q, i) => `${i + 1}. Q: ${q.question}\n   Expected: ${q.expected}`),
  '',
  `## Answers given\n\n${answers.trim()}`
].join('\n')

export function parseGrades(text: string, qs: CheckQuestion[], answers: string): CheckResult[] {
  let arr: { n?: number; ok?: boolean; note?: string }[] = []
  const s = text.indexOf('['); const e = text.lastIndexOf(']')
  if (s >= 0 && e > s) { try { arr = JSON.parse(text.slice(s, e + 1)) } catch { arr = [] } }
  // Split the answers by their numbering so each result can show what the fresh chat said.
  const parts = answers.split(/\n(?=\s*\d+[.)]\s)/).map((p) => p.replace(/^\s*\d+[.)]\s*/, '').trim())
  return qs.map((q, i) => {
    const g = arr.find((x) => x.n === i + 1)
    return { ...q, answer: parts[i] ?? '', ok: !!g?.ok, note: g?.note || undefined }
  })
}
