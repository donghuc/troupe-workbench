// The decisions log (D-080 items 1 + 3, D-081 steps 5–6): dated outcomes with their
// reasons, one per project, kept as Markdown so it is readable and editable by hand
// and by any agent. Pure: parsing, formatting, the agent-facing context block and the
// drafting prompt. Storage lives in main (decisionsRepo.ts).

export type OutcomeKind = 'decision' | 'insight' | 'question'
export const OUTCOME_KINDS: { v: OutcomeKind; l: string }[] = [
  { v: 'decision', l: 'Decision' }, { v: 'insight', l: 'Insight' }, { v: 'question', l: 'Open question' }
]
const kindLabel = (k: OutcomeKind): string => OUTCOME_KINDS.find((x) => x.v === k)?.l ?? 'Decision'
const kindFromLabel = (l: string): OutcomeKind => OUTCOME_KINDS.find((x) => x.l.toLowerCase() === l.trim().toLowerCase())?.v ?? 'decision'

export interface Outcome {
  id: string            // D-001 …
  kind: OutcomeKind
  date: string          // YYYY-MM-DD
  title: string         // the decision / insight / question, one line
  why?: string
  considered?: string   // what else was on the table, and who argued what
  open?: string         // what is still unsettled
  source?: string       // the chat it came from (title)
  conflicts?: string    // set on a draft when it contradicts memory or an earlier entry; not stored
}

// D-103: Troupe's own name, so it never appends to a project's existing DECISIONS.md.
// Projects that already have Troupe's log under the old name are moved over on first use.
export const DECISIONS_FILE = 'TROUPE-DECISIONS.md'
export const LEGACY_DECISIONS_FILE = 'DECISIONS.md'

/** True when a DECISIONS.md was written by Troupe (its header, or entries in Troupe's format) — not the user's own file. */
export function isTroupeDecisionsLog(md: string | null | undefined): boolean {
  if (!md?.trim()) return false
  return /Kept by Troupe/.test(md) || parseDecisions(md).length > 0
}
const DECISIONS_INDEX_MAX = 50   // D-080 item 3: latest 50 in the index
const DECISIONS_FULL_N = 3       // and the latest 3 in full

const HEAD_RE = /^## (D-\d{3,}) · (Decision|Insight|Open question) · (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/
const FIELD_RE = /^\*\*(Why|Considered|Open|From):\*\*\s*(.*)$/

/** Entries as they appear in the file: newest first. Tolerates hand edits; skips junk. */
export function parseDecisions(md: string | null | undefined): Outcome[] {
  const out: Outcome[] = []
  let cur: Outcome | null = null
  let field: keyof Outcome | null = null
  const flush = () => { if (cur) out.push(cur); cur = null; field = null }
  for (const raw of (md ?? '').split(/\r?\n/)) {
    const h = HEAD_RE.exec(raw)
    if (h) { flush(); cur = { id: h[1], kind: kindFromLabel(h[2]), date: h[3], title: h[4].trim() }; continue }
    if (!cur) continue
    if (/^## /.test(raw) || /^# /.test(raw)) { flush(); continue }
    const f = FIELD_RE.exec(raw)
    if (f) {
      field = ({ Why: 'why', Considered: 'considered', Open: 'open', From: 'source' } as const)[f[1] as 'Why' | 'Considered' | 'Open' | 'From']
      ;(cur as any)[field] = f[2].trim()
      continue
    }
    if (field && raw.trim()) (cur as any)[field] = `${(cur as any)[field] ?? ''}\n${raw.trim()}`.trim()
    else if (!raw.trim()) field = null
  }
  flush()
  return out
}

export function formatOutcome(o: Outcome): string {
  const lines = [`## ${o.id} · ${kindLabel(o.kind)} · ${o.date} · ${o.title.trim()}`]
  if (o.why?.trim()) lines.push(`**Why:** ${o.why.trim()}`)
  if (o.considered?.trim()) lines.push(`**Considered:** ${o.considered.trim()}`)
  if (o.open?.trim()) lines.push(`**Open:** ${o.open.trim()}`)
  if (o.source?.trim()) lines.push(`**From:** ${o.source.trim()}`)
  return lines.join('\n')
}

export function nextOutcomeId(existing: Outcome[]): string {
  const max = existing.reduce((m, o) => Math.max(m, Number(o.id.slice(2)) || 0), 0)
  return `D-${String(max + 1).padStart(3, '0')}`
}

/** Newest entry on top, under a header the file gets on first write. */
export function appendOutcome(md: string | null | undefined, o: Outcome, projectName: string): string {
  const cur = (md ?? '').replace(/\s+$/, '')
  const entry = formatOutcome(o)
  if (!cur.trim()) return `# Decisions · ${projectName}\n\nDated outcomes with their reasons, newest first. Kept by Troupe; edit freely.\n\n${entry}\n`
  const firstEntry = cur.search(/^## D-\d+ · /m)
  if (firstEntry === -1) return `${cur}\n\n${entry}\n`
  return `${cur.slice(0, firstEntry).replace(/\s+$/, '')}\n\n${entry}\n\n${cur.slice(firstEntry)}\n`
}

/** What every agent gets (D-080 item 3): an index of the latest entries and the newest few in full. */
export function decisionsContext(list: Outcome[], indexMax = DECISIONS_INDEX_MAX, fullN = DECISIONS_FULL_N): string {
  if (!list.length) return ''
  const idx = list.slice(0, indexMax)
  const rest = list.length - idx.length
  const lines = [
    '# Decisions log (this project)',
    `Dated outcomes with reasons. Follow them unless the reason no longer holds — then say so. The full log is in ${DECISIONS_FILE}; open it for older entries or details.`,
    '',
    '## Index (newest first)',
    ...idx.map((o) => `- ${o.id} · ${o.date} · ${kindLabel(o.kind)} · ${o.title}`),
    ...(rest > 0 ? [`- …and ${rest} earlier — search ${DECISIONS_FILE}`] : []),
    '',
    `## Latest ${Math.min(fullN, list.length)} in full`,
    ...list.slice(0, fullN).map(formatOutcome)
  ]
  return lines.join('\n')
}

// ── Drafting (D-081 step 6) ──────────────────────────────────────────────────
export interface OutcomeDraftInput {
  transcript: string        // the exchange to capture (labelled turns)
  memory: string            // the project's facts (may be '')
  existing: Outcome[]       // for the contradiction check + to avoid duplicates
  chatTitle: string
}

export function buildOutcomePrompt(inp: OutcomeDraftInput): string {
  const idx = inp.existing.slice(0, DECISIONS_INDEX_MAX).map((o) => `- ${o.id} · ${o.date} · ${kindLabel(o.kind)} · ${o.title}${o.why ? ` — why: ${o.why.slice(0, 160)}` : ''}`).join('\n')
  return [
    'You are recording the outcome of a conversation for a project decisions log. The reader wants a record they can trust and check in a few seconds. Reply with ONE JSON object and nothing else, in this shape:',
    '{"kind":"decision|insight|question","title":"…","why":"…","considered":"…","open":"…","conflicts":"…"}',
    '',
    'Field rules:',
    '- kind: "decision" = a choice was made between options; "insight" = something learned that will stay true; "question" = the exchange ended on an unresolved question worth keeping.',
    '- title: the outcome itself in one plain sentence (max 120 characters). Not a topic — the actual decision, insight or question.',
    '- why: the reasoning in one or two sentences. For a question: why it matters.',
    '- considered: the alternatives that were on the table and who argued for what, briefly (agents by name). "" if none.',
    '- open: what is still unsettled or the next step to settle it. "" if nothing.',
    '- conflicts: if this outcome contradicts a fact in the project memory or an earlier entry in the index, say which one and how in one sentence (e.g. "Contradicts D-004: …"). "" if none.',
    'Do not quote long passages. Do not invent anything not in the exchange. Prefer the user\'s own words for the title when they stated the outcome.',
    '',
    `## Project memory (facts)\n\n${inp.memory.trim() || '(empty)'}`,
    '',
    `## Existing log index\n\n${idx || '(empty)'}`,
    '',
    `## The exchange (chat: "${inp.chatTitle}")\n\n${inp.transcript.trim()}`
  ].join('\n')
}

/** Pull the draft out of the agent's reply (tolerates fences and surrounding prose). */
export function parseOutcomeDraft(text: string): Partial<Outcome> | null {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    const o = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
    const kind = (['decision', 'insight', 'question'] as OutcomeKind[]).includes(o.kind as OutcomeKind) ? (o.kind as OutcomeKind) : 'decision'
    const title = str('title'); if (!title) return null
    return { kind, title, why: str('why') || undefined, considered: str('considered') || undefined, open: str('open') || undefined, conflicts: str('conflicts') || undefined }
  } catch { return null }
}

export const today = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
