// Reply blocks (D-149): an agent writes a fenced block tagged `troupe-<kind>` holding one JSON
// object; the chat draws it as a component. Pure rules shared by the renderer (parse, answer
// text), main (the agent guide, the [blocks] log) and tests. Anything that doesn't pass stays
// an ordinary code block, so a bad block never loses text.

export const REPLY_BLOCKS_SETTING = 'reply_blocks'
/** On unless switched off in Settings ▸ Conversations. */
export const replyBlocksOn = (raw: string | null | undefined): boolean => raw !== '0'

const KINDS = ['steps', 'choices', 'sources'] as const
type BlockKind = typeof KINDS[number]
const FENCE_PREFIX = 'troupe-'

export interface StepsBlock { kind: 'steps'; title?: string; steps: { title: string; body?: string }[] }
export interface ChoicesBlock {
  kind: 'choices'; id: string; title?: string; intro?: string
  groups: { label: string; options: string[]; multi?: boolean }[]
  submit: string; note?: string
}
export interface SourcesBlock { kind: 'sources'; sources: { title: string; url: string }[] }
export type ReplyBlock = StepsBlock | ChoicesBlock | SourcesBlock
type BlockResult = { ok: true; block: ReplyBlock } | { ok: false; problem: string }

/** The block kind named by a code element's class (`language-troupe-steps`); null = not a block. */
export function blockKindOf(className: string | undefined): string | null {
  const m = /(?:^|\s)language-troupe-([\w-]+)/.exec(className ?? '')
  return m ? m[1] : null
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// A stable id for a choices block the agent didn't name: same content → same id, so an
// answer saved against it is found again after a reload.
function contentId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return `c${h.toString(36)}`
}

/** Check a block's JSON against its kind's rules. */
export function parseBlock(kind: string, raw: string): BlockResult {
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false, problem: `unknown kind "${kind}"` }
  let j: unknown
  try { j = JSON.parse(raw) } catch { return { ok: false, problem: 'not valid JSON' } }
  if (!isObj(j)) return { ok: false, problem: 'not a JSON object' }
  const k = kind as BlockKind
  if (k === 'steps') {
    if (!Array.isArray(j.steps)) return { ok: false, problem: '"steps" must be a list' }
    const steps = j.steps.filter(isObj).map((s) => ({ title: str(s.title, 200), body: str(s.body, 2000) })).filter((s) => s.title)
    if (steps.length < 2 || steps.length > 12) return { ok: false, problem: 'needs 2–12 steps, each with a title' }
    return { ok: true, block: { kind: 'steps', title: str(j.title, 200), steps: steps.map((s) => ({ title: s.title!, ...(s.body ? { body: s.body } : {}) })) } }
  }
  if (k === 'choices') {
    if (!Array.isArray(j.groups)) return { ok: false, problem: '"groups" must be a list' }
    const groups = j.groups.filter(isObj).map((g) => ({
      label: str(g.label, 200) ?? '',
      options: (Array.isArray(g.options) ? g.options : []).map((o) => str(o, 200)).filter((o): o is string => !!o),
      multi: g.multi === true
    }))
    if (groups.length < 1 || groups.length > 6) return { ok: false, problem: 'needs 1–6 groups' }
    const bad = groups.find((g) => !g.label || g.options.length < 2 || g.options.length > 8 || new Set(g.options).size !== g.options.length)
    if (bad) return { ok: false, problem: 'each group needs a label and 2–8 different options' }
    const submit = str(j.submit, 60) ?? 'Send answers'   // agents sometimes leave it out (D-149 test)
    const id = str(j.id, 80) ?? contentId(JSON.stringify(groups))
    return { ok: true, block: { kind: 'choices', id, title: str(j.title, 200), intro: str(j.intro, 1000), note: str(j.note, 1000), submit, groups: groups.map((g) => ({ label: g.label, options: g.options, ...(g.multi ? { multi: true } : {}) })) } }
  }
  if (!Array.isArray(j.sources)) return { ok: false, problem: '"sources" must be a list' }
  const sources = j.sources.filter(isObj).map((s) => ({ title: str(s.title, 200), url: str(s.url, 2000) }))
    .filter((s): s is { title: string; url: string } => !!s.title && !!s.url && /^https?:\/\//i.test(s.url))
  if (sources.length < 1 || sources.length > 8) return { ok: false, problem: 'needs 1–8 sources with a title and an http(s) url' }
  return { ok: true, block: { kind: 'sources', sources } }
}

/** What a choices answer says as the user's message: the title, then one line per group. */
export function answerText(b: ChoicesBlock, values: string[][]): string {
  const lines = b.groups.map((g, i) => `${g.label}: ${(values[i] ?? []).join(', ')}`)
  return [b.title, ...lines].filter(Boolean).join('\n')
}

/** Every group answered with options it offers (one, unless the group takes several). */
export function answerComplete(b: ChoicesBlock, values: string[][]): boolean {
  return b.groups.every((g, i) => {
    const v = values[i] ?? []
    return v.length >= 1 && (g.multi || v.length === 1) && v.every((o) => g.options.includes(o))
  })
}

/** A user message's answer to a choices block (message metadata `uiAnswer`). */
interface UiAnswer { messageId: string; blockId: string; values: string[][] }
export function uiAnswerOf(meta: Record<string, unknown> | null | undefined): UiAnswer | null {
  const a = meta?.uiAnswer
  if (!isObj(a) || typeof a.messageId !== 'string' || typeof a.blockId !== 'string' || !Array.isArray(a.values)) return null
  return { messageId: a.messageId, blockId: a.blockId, values: a.values.map((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])) }
}

/** The blocks in a finished reply, for the [blocks] log: kind and whether it passed. */
export function scanBlocks(text: string): { kind: string; ok: boolean; problem?: string }[] {
  const out: { kind: string; ok: boolean; problem?: string }[] = []
  const re = new RegExp('^ {0,3}(`{3,}|~{3,})[ \\t]*' + FENCE_PREFIX + '([\\w-]+)[^\\n]*\\n([\\s\\S]*?)^ {0,3}\\1[ \\t]*$', 'gm')
  for (const m of text.matchAll(re)) {
    const r = parseBlock(m[2], m[3])
    out.push(r.ok ? { kind: m[2], ok: true } : { kind: m[2], ok: false, problem: r.problem })
  }
  return out
}

/** What every chat agent is told (D-149). Fixed text, so it stays in the prompt cache.
 *  v2 after the first test (2026-11-16): says what each block replaces, so agents stop
 *  falling back to lists; one example per kind. */
export const REPLY_BLOCK_GUIDE = `## Reply blocks
This chat draws three kinds of block inside your reply. A block is a fenced code block whose language is \`troupe-<kind>\` and whose body is one JSON object. In these cases write the block instead of the markdown you would otherwise use:
- A plan, schedule, itinerary, routine or any sequence of 3 or more stages or actions → \`troupe-steps\` instead of a numbered or bulleted list. This includes a revised plan in a follow-up. Shape: {"title"?: string, "steps": [{"title": string, "body"?: string}]} (2–12 steps; body is short markdown).
- Questions the user must answer before you can continue → one \`troupe-choices\` block instead of a list of questions. Give each question its likely answers as options. A question that needs a free-text answer (a date, a name, a number) goes in one sentence after the block. Shape: {"id": string, "title"?: string, "intro"?: string, "groups": [{"label": string, "options": [string], "multi"?: true}], "submit": string, "note"?: string} (1–6 groups, 2–8 options each; one choice per group unless "multi"; "submit" is the button label). The answers come back as the user's next message; then do the work. If some answers are missing, assume sensible ones, say what you assumed, and still do the work — don't ask again.
- Web pages you looked up for this reply and relied on → \`troupe-sources\` at the end instead of inline links. Shape: {"sources": [{"title": string, "url": string}]} (1–8, http/https). Not for general knowledge, not when you didn't search, and not as extra reading.
Put a short sentence of prose before a block. Never use a block for code, file contents or tables. At most one troupe-choices per reply. Write the text in the user's language; the JSON keys stay in English. Examples:
\`\`\`troupe-steps
{"title": "Rollout", "steps": [{"title": "Week 1 — pilot", "body": "Two teams, daily check-ins."}, {"title": "Week 2 — everyone", "body": "Turn it on for all teams."}]}
\`\`\`
\`\`\`troupe-choices
{"id": "setup", "title": "Before I start", "groups": [{"label": "Team size", "options": ["1–5", "6–20", "More than 20"]}, {"label": "Platforms", "options": ["Web", "iOS", "Android"], "multi": true}], "submit": "Write the plan"}
\`\`\`
\`\`\`troupe-sources
{"sources": [{"title": "Release notes", "url": "https://example.com/releases"}]}
\`\`\``
