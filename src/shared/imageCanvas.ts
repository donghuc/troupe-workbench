// Image canvas (D-088): a node canvas where Prompt + Media cards feed a Processor card
// that runs one image-capable agent, and Output cards show what it made.
// Pure — no electron, no fs — so the rules (what may connect, what a run receives,
// the prompt contract) are unit-tested (imageCanvas.test.ts).
import type { ProviderId } from './types'
import { fileBase } from './platform'

export const IMAGE_FOLDER_SETTING = 'image_folder'
export const CANVAS_FILE = 'canvas.json'
export const INPUTS_DIR = 'inputs'
export const OUTPUTS_DIR = 'outputs'   // generated — every run, disposable
export const SAVED_DIR = 'saved'       // kept — copies the user chose to save (Hien, 2026-10-05)
export const HISTORY_DIR = '.history'

/** Agents offered on a Processor. Codex/Grok/Gemini make raster images; Claude has no
 *  image model, so it draws vector illustrations (SVG) instead (Hien, 2026-10-05). */
export const IMAGE_AGENTS: ProviderId[] = ['codex', 'grok', 'gemini', 'claude-code']
/** Agents that draw SVG rather than generate raster images. */
const VECTOR_AGENTS: ProviderId[] = ['claude-code']
export const isVectorAgent = (id: string): boolean => (VECTOR_AGENTS as string[]).includes(id)
/** Agents whose image tool saves into its own folder and that have no way to move files in
 *  an Image run (Grok: session dir). They're told not to save anything; Troupe collects. */
const SELF_SAVING_AGENTS: ProviderId[] = ['grok']
export const isSelfSavingAgent = (id: string): boolean => (SELF_SAVING_AGENTS as string[]).includes(id)
export const isImageAgent = (id: string): id is ProviderId => (IMAGE_AGENTS as string[]).includes(id)

export type CardKind = 'prompt' | 'media' | 'processor' | 'output'
export type PortType = 'text' | 'images'

export interface RunRecord {
  id: string
  at: string                 // ISO time
  agent: ProviderId
  model: string              // '' = the agent's default
  files: string[]            // paths relative to the image folder
  error?: string
  inputsHash: string         // inputs + engine at run time, for the stale marker
}

export interface PromptData { text: string }
export interface MediaData { files: string[] }                      // relative to the image folder
export interface ProcessorData { slots: string[]; agent: ProviderId; model: string; count: number }
export interface OutputData {
  runs: RunRecord[]
  selected: string[]                 // files passed on to the next card
  saved: Record<string, string>      // generated path → its copy in saved/
}

export type Card =
  | { id: string; kind: 'prompt'; x: number; y: number; title?: string; data: PromptData }
  | { id: string; kind: 'media'; x: number; y: number; title?: string; data: MediaData }
  | { id: string; kind: 'processor'; x: number; y: number; title?: string; data: ProcessorData }
  | { id: string; kind: 'output'; x: number; y: number; title?: string; data: OutputData }

/** An edge always runs from a card's single output port into one input slot of another card. */
export interface Edge { id: string; from: string; to: string; slot: string }

export interface Canvas {
  version: 1
  cards: Card[]
  edges: Edge[]
  view: { x: number; y: number; zoom: number }
}

export const emptyCanvas = (): Canvas => ({ version: 1, cards: [], edges: [], view: { x: 0, y: 0, zoom: 1 } })

export const newId = (prefix = ''): string =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** The single input slot id of an Output card. */
export const OUTPUT_SLOT = 'in'

export const CARD_LABEL: Record<CardKind, string> = { prompt: 'Prompt', media: 'Media', processor: 'Processor', output: 'Output' }

export function makeCard(kind: CardKind, x: number, y: number, defaults: { agent?: ProviderId } = {}): Card {
  const id = newId(kind[0])
  switch (kind) {
    case 'prompt': return { id, kind, x, y, data: { text: '' } }
    case 'media': return { id, kind, x, y, data: { files: [] } }
    case 'processor': return { id, kind, x, y, data: { slots: [newId('s')], agent: defaults.agent ?? 'codex', model: '', count: 1 } }
    case 'output': return { id, kind, x, y, data: { runs: [], selected: [], saved: {} } }
  }
}

/** The input slot ids a card has, in order. */
function inputSlots(card: Card): string[] {
  if (card.kind === 'processor') return card.data.slots
  if (card.kind === 'output') return [OUTPUT_SLOT]
  return []
}

/** Which kinds may feed which: text/images into a Processor; a Processor into an Output. */
function accepts(target: CardKind, source: CardKind): boolean {
  if (target === 'processor') return source === 'prompt' || source === 'media' || source === 'output'
  if (target === 'output') return source === 'processor'
  return false
}

/** Would an edge from → to close a loop? (Output → Processor makes one possible.) */
function reaches(c: Canvas, start: string, goal: string): boolean {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    if (id === goal) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of c.edges) if (e.from === id) stack.push(e.to)
  }
  return false
}

export type ConnectCheck = { ok: true } | { ok: false; reason: string }

export function canConnect(c: Canvas, fromId: string, toId: string, slot: string): ConnectCheck {
  const from = c.cards.find((k) => k.id === fromId)
  const to = c.cards.find((k) => k.id === toId)
  if (!from || !to) return { ok: false, reason: 'Card not found' }
  if (from.id === to.id) return { ok: false, reason: 'A card can’t feed itself' }
  if (!inputSlots(to).includes(slot)) return { ok: false, reason: 'No such input' }
  if (!accepts(to.kind, from.kind)) return { ok: false, reason: `${CARD_LABEL[from.kind]} can’t connect to ${CARD_LABEL[to.kind]}` }
  if (reaches(c, to.id, from.id)) return { ok: false, reason: 'That would make a loop' }
  return { ok: true }
}

/** Connect, replacing whatever was in that slot. Returns the canvas unchanged if not allowed. */
export function connect(c: Canvas, fromId: string, toId: string, slot: string): Canvas {
  if (!canConnect(c, fromId, toId, slot).ok) return c
  const edges = c.edges.filter((e) => !(e.to === toId && e.slot === slot))
  return { ...c, edges: [...edges, { id: newId('e'), from: fromId, to: toId, slot }] }
}

export function removeCard(c: Canvas, id: string): Canvas {
  return { ...c, cards: c.cards.filter((k) => k.id !== id), edges: c.edges.filter((e) => e.from !== id && e.to !== id) }
}

export function removeSlot(c: Canvas, cardId: string, slot: string): Canvas {
  return {
    ...c,
    cards: c.cards.map((k) => (k.id === cardId && k.kind === 'processor' && k.data.slots.length > 1
      ? { ...k, data: { ...k.data, slots: k.data.slots.filter((s) => s !== slot) } } : k)),
    edges: c.edges.filter((e) => !(e.to === cardId && e.slot === slot))
  }
}

export const updateCard = (c: Canvas, id: string, fn: (k: Card) => Card): Canvas =>
  ({ ...c, cards: c.cards.map((k) => (k.id === id ? fn(k) : k)) })

/** The images an Output card passes on: the selected ones, else the latest run's. */
export function outputImages(card: Card): string[] {
  if (card.kind !== 'output') return []
  if (card.data.selected.length) return card.data.selected
  const last = [...card.data.runs].reverse().find((r) => r.files.length)
  return last ? last.files : []
}

export interface ProcessorInputs { prompt: string; refs: string[] }

/** What a Processor receives: text joined in slot order, reference images de-duplicated. */
export function gatherInputs(c: Canvas, processorId: string): ProcessorInputs {
  const p = c.cards.find((k) => k.id === processorId)
  if (!p || p.kind !== 'processor') return { prompt: '', refs: [] }
  const texts: string[] = []
  const refs: string[] = []
  for (const slot of p.data.slots) {
    const e = c.edges.find((x) => x.to === p.id && x.slot === slot)
    const src = e && c.cards.find((k) => k.id === e.from)
    if (!src) continue
    if (src.kind === 'prompt' && src.data.text.trim()) texts.push(src.data.text.trim())
    else if (src.kind === 'media') refs.push(...src.data.files)
    else if (src.kind === 'output') refs.push(...outputImages(src))
  }
  return { prompt: texts.join('\n\n'), refs: [...new Set(refs)] }
}

/** Stable fingerprint of a run's inputs + engine (FNV-1a), for "inputs changed" markers. */
export function inputsHash(inp: ProcessorInputs, agent: string, model: string, count: number): string {
  const s = JSON.stringify([inp.prompt, inp.refs, agent, model, count])
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16)
}

/** Output cards fed by a processor. */
export const outputsOf = (c: Canvas, processorId: string): Card[] =>
  c.edges.filter((e) => e.from === processorId).map((e) => c.cards.find((k) => k.id === e.to)).filter((k): k is Card => !!k && k.kind === 'output')

/** The processor feeding an Output card, if any. */
export function processorOf(c: Canvas, outputId: string): Card | undefined {
  const e = c.edges.find((x) => x.to === outputId && x.slot === OUTPUT_SLOT)
  const k = e && c.cards.find((x) => x.id === e.from)
  return k && k.kind === 'processor' ? k : undefined
}

// ── Indexes for large canvases (image perf, 2026-10) ──────────────────────────
// The helpers above scan cards/edges linearly; fine for one call, quadratic when every card
// on screen calls them on every render. A CanvasIndex is built once per canvas version.

export interface CardIndex {
  byId: Map<string, Card>
  /** `${to}|${slot}` → the edge filling that input slot */
  inSlot: Map<string, Edge>
  /** card id → edges leaving it */
  outOf: Map<string, Edge[]>
}

export function indexCanvas(c: Canvas): CardIndex {
  const byId = new Map(c.cards.map((k) => [k.id, k]))
  const inSlot = new Map<string, Edge>()
  const outOf = new Map<string, Edge[]>()
  for (const e of c.edges) {
    if (!inSlot.has(`${e.to}|${e.slot}`)) inSlot.set(`${e.to}|${e.slot}`, e)   // first wins, like edges.find
    const l = outOf.get(e.from); if (l) l.push(e); else outOf.set(e.from, [e])
  }
  return { byId, inSlot, outOf }
}

/** gatherInputs with an index: O(slots) instead of O(slots × (edges + cards)). */
export function gatherInputsIx(ix: CardIndex, processorId: string): ProcessorInputs {
  const p = ix.byId.get(processorId)
  if (!p || p.kind !== 'processor') return { prompt: '', refs: [] }
  const texts: string[] = []
  const refs: string[] = []
  for (const slot of p.data.slots) {
    const e = ix.inSlot.get(`${p.id}|${slot}`)
    const src = e && ix.byId.get(e.from)
    if (!src) continue
    if (src.kind === 'prompt' && src.data.text.trim()) texts.push(src.data.text.trim())
    else if (src.kind === 'media') refs.push(...src.data.files)
    else if (src.kind === 'output') refs.push(...outputImages(src))
  }
  return { prompt: texts.join('\n\n'), refs: [...new Set(refs)] }
}

/**
 * Every target a connection from `fromId` may land on, decided in one pass: the cards that can
 * reach `fromId` (its ancestors) would close a loop. Same answers as canConnect, but O(1) per
 * slot after an O(cards + edges) setup — canConnect ran a graph search per slot, per pointer
 * move (121 ms a move at 500 chained cards).
 */
export function connectChecker(c: Canvas, fromId: string): (toId: string, slot: string) => ConnectCheck {
  const byId = new Map(c.cards.map((k) => [k.id, k]))
  const into = new Map<string, string[]>()
  for (const e of c.edges) { const l = into.get(e.to); if (l) l.push(e.from); else into.set(e.to, [e.from]) }
  const ancestors = new Set<string>([fromId])
  const stack = [fromId]
  while (stack.length) for (const a of into.get(stack.pop()!) ?? []) if (!ancestors.has(a)) { ancestors.add(a); stack.push(a) }
  const from = byId.get(fromId)
  return (toId, slot) => {
    const to = byId.get(toId)
    if (!from || !to) return { ok: false, reason: 'Card not found' }
    if (from.id === to.id) return { ok: false, reason: 'A card can’t feed itself' }
    if (!inputSlots(to).includes(slot)) return { ok: false, reason: 'No such input' }
    if (!accepts(to.kind, from.kind)) return { ok: false, reason: `${CARD_LABEL[from.kind]} can’t connect to ${CARD_LABEL[to.kind]}` }
    if (ancestors.has(to.id)) return { ok: false, reason: 'That would make a loop' }
    return { ok: true }
  }
}

/** What a card shows that depends on other cards (labels of its inputs, last run, "inputs
 *  changed"). Computed for every card from one index; plain data, so a card whose view didn't
 *  change keeps the same object and doesn't re-render (see stabilize). */
export interface CardView {
  slots?: { slot: string; label: string; filled: boolean }[]
  lastRun?: { at: string; error?: string; ok: boolean }
  procId?: string
  stale?: boolean
  feedsOn?: boolean
  hint?: string
}

export function sourceLabel(src: Card | undefined): string {
  if (!src) return 'Empty — drag an output here'
  if (src.kind === 'prompt') { const t = src.data.text.trim(); return t ? `Prompt · “${t.slice(0, 28)}${t.length > 28 ? '…' : ''}”` : 'Prompt · empty' }
  if (src.kind === 'media') return `Media · ${src.data.files.length} image${src.data.files.length === 1 ? '' : 's'}`
  if (src.kind === 'output') { const n = outputImages(src).length; return `Output · ${n} image${n === 1 ? '' : 's'}` }
  return CARD_LABEL[src.kind]
}

export function cardViews(c: Canvas, running: (processorId: string) => boolean, ix: CardIndex = indexCanvas(c)): Map<string, CardView> {
  const out = new Map<string, CardView>()
  for (const k of c.cards) {
    if (k.kind === 'processor') {
      const slots = k.data.slots.map((slot) => { const e = ix.inSlot.get(`${k.id}|${slot}`); const src = e && ix.byId.get(e.from); return { slot, label: sourceLabel(src), filled: !!src } })
      let last: RunRecord | undefined
      for (const e of ix.outOf.get(k.id) ?? []) {
        const o = ix.byId.get(e.to)
        if (o?.kind !== 'output') continue
        const r = o.data.runs[o.data.runs.length - 1]
        if (r && (!last || r.at > last.at)) last = r
      }
      out.set(k.id, { slots, ...(last ? { lastRun: { at: last.at, ok: last.files.length > 0, ...(last.error ? { error: last.error } : {}) } } : {}) })
    } else if (k.kind === 'output') {
      const e = ix.inSlot.get(`${k.id}|${OUTPUT_SLOT}`)
      const proc = e && ix.byId.get(e.from)
      const feedsOn = (ix.outOf.get(k.id)?.length ?? 0) > 0
      if (!proc || proc.kind !== 'processor') { out.set(k.id, { feedsOn }); continue }
      const inputs = gatherInputsIx(ix, proc.id)
      const last = k.data.runs[k.data.runs.length - 1]
      const stale = !!(last && last.inputsHash && !running(proc.id) && last.inputsHash !== inputsHash(inputs, proc.data.agent, proc.data.model, proc.data.count))
      out.set(k.id, { procId: proc.id, stale, feedsOn, hint: inputs.prompt })
    } else out.set(k.id, {})
  }
  return out
}

/** Keep the previous object for every card whose view is unchanged (value equality), so
 *  memoized cards skip re-rendering. */
export function stabilize<T>(prev: Map<string, T> | null, next: Map<string, T>): Map<string, T> {
  if (!prev) return next
  const keyOf = (v: T) => JSON.stringify(v)
  for (const [id, v] of next) { const p = prev.get(id); if (p !== undefined && keyOf(p) === keyOf(v)) next.set(id, p) }
  return next
}

export function validateRun(inp: ProcessorInputs): string | null {
  if (!inp.prompt.trim()) return 'Connect a Prompt card with a description first.'
  return null
}

/**
 * The prompt contract sent to the agent. Agents aren't image APIs: the only control we
 * have is the instruction, so it pins the count, the folder and the reply format, and
 * the service still sweeps for images saved elsewhere (imageService.collect).
 */
export function buildImagePrompt(opts: { prompt: string; refs: string[]; count: number; outDir: string; vector?: boolean; selfSaving?: boolean }): string {
  const n = Math.max(1, Math.min(4, Math.round(opts.count) || 1))
  const ext = opts.vector ? 'svg' : 'png'
  const lines = [opts.vector
    ? `Create ${n === 1 ? 'one illustration' : `${n} separate illustrations`} for the brief below as self-contained SVG files (you have no image generation tool, so draw it as vector art). Use a viewBox (e.g. 0 0 1024 1024), no external references, scripts or fonts that need loading; make it as rich and polished as the brief deserves.`
    : `Generate ${n === 1 ? 'one image' : `${n} separate images`} for the brief below, using your image generation tool. Make a real raster image — not SVG, HTML or code.`
  ]
  if (opts.refs.length) {
    lines.push('', `Reference images (${opts.refs.length}), relative to the current folder — open and use them as the brief says (subject, style, composition):`)
    for (const r of opts.refs) lines.push(`- ${r}`)
  }
  lines.push('')
  if (opts.selfSaving) {
    // B-051: Grok's image tool saves into its own session folder and it can't move files in
    // an Image run — asked to, it burned 10 minutes improvising. Troupe collects instead.
    lines.push(`Your image tool saves each image by itself, and Troupe collects it from there. Do not try to copy, move, convert or save any file, and do not use any other tool. As soon as ${n === 1 ? 'the image exists' : `the ${n} images exist`}, stop and reply with one word: done.`)
  } else {
    lines.push(
      `Save every final image as ${opts.vector ? 'an SVG' : 'a PNG'} inside the folder \`${opts.outDir}\` (relative to the current folder), named image-1.${ext}${n > 1 ? `, image-2.${ext}, …` : ''}. Create the folder if needed.`,
      'Do not save images anywhere else, do not modify the reference images or any other file, and do not run unrelated commands.',
      'When done, reply with only the relative paths of the saved files, one per line.'
    )
  }
  lines.push('', 'Brief:', opts.prompt.trim())
  return lines.join('\n')
}

/** Parse canvas.json; anything malformed is dropped rather than crashing the view. */
export function parseCanvas(raw: string | null | undefined): Canvas {
  let j: any
  try { j = JSON.parse(raw ?? '') } catch { return emptyCanvas() }
  if (!j || typeof j !== 'object') return emptyCanvas()
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  const cards: Card[] = []
  for (const k of Array.isArray(j.cards) ? j.cards : []) {
    if (!k || typeof k.id !== 'string') continue
    const base = { id: k.id, x: num(k.x, 0), y: num(k.y, 0), ...(typeof k.title === 'string' ? { title: k.title } : {}) }
    const d = k.data ?? {}
    if (k.kind === 'prompt') cards.push({ ...base, kind: 'prompt', data: { text: typeof d.text === 'string' ? d.text : '' } })
    else if (k.kind === 'media') cards.push({ ...base, kind: 'media', data: { files: strs(d.files) } })
    else if (k.kind === 'processor') {
      const slots = strs(d.slots)
      cards.push({ ...base, kind: 'processor', data: { slots: slots.length ? slots : [newId('s')], agent: isImageAgent(d.agent) ? d.agent : 'codex', model: typeof d.model === 'string' ? d.model : '', count: Math.max(1, Math.min(4, num(d.count, 1))) } })
    } else if (k.kind === 'output') {
      const runs: RunRecord[] = (Array.isArray(d.runs) ? d.runs : []).filter((r: any) => r && typeof r.id === 'string').map((r: any) => ({
        id: r.id, at: typeof r.at === 'string' ? r.at : '', agent: isImageAgent(r.agent) ? r.agent : 'codex',
        model: typeof r.model === 'string' ? r.model : '', files: strs(r.files),
        ...(typeof r.error === 'string' ? { error: r.error } : {}), inputsHash: typeof r.inputsHash === 'string' ? r.inputsHash : ''
      }))
      const saved: Record<string, string> = {}
      if (d.saved && typeof d.saved === 'object') for (const [k, v] of Object.entries(d.saved)) if (typeof v === 'string') saved[k] = v
      cards.push({ ...base, kind: 'output', data: { runs, selected: strs(d.selected), saved } })
    }
  }
  const ids = new Set(cards.map((k) => k.id))
  const edges: Edge[] = (Array.isArray(j.edges) ? j.edges : [])
    .filter((e: any) => e && typeof e.id === 'string' && ids.has(e.from) && ids.has(e.to) && typeof e.slot === 'string')
    .map((e: any) => ({ id: e.id, from: e.from, to: e.to, slot: e.slot }))
  const v = j.view ?? {}
  return { version: 1, cards, edges, view: { x: num(v.x, 0), y: num(v.y, 0), zoom: Math.max(0.25, Math.min(2, num(v.zoom, 1))) } }
}

const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
export const isImagePath = (p: string): boolean => IMG_RE.test(p)

/** Image paths mentioned in an agent's reply (one per line, possibly in backticks or a markdown link). */
export function imagePathsInReply(text: string): string[] {
  const out: string[] = []
  const re = /(?:\]\(|`|^|\s)(\/?[^\s`()<>"']+\.(?:png|jpe?g|webp|gif|avif|svg))(?=$|[\s`)\]"',.;:])/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1].replace(/^\.\//, ''))
  return [...new Set(out)]
}

/**
 * File name for a saved copy: date, a slug of the prompt, and the source name, e.g.
 * `2026-10-05-cute-little-girl-image-1.png`. The service adds -2, -3… on a clash.
 */
export function savedName(hint: string, source: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const stop = new Set(['a', 'an', 'the', 'of', 'that', 'and', 'with', 'for', 'to', 'in', 'on', 'at', 'is', 'be', 'should', 'generate', 'create', 'make', 'photo', 'image', 'picture'])
  const slug = hint.toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').split(/\s+/).filter((w) => w && !stop.has(w)).slice(0, 4).join('-')
  const base = fileBase(source) || 'image.png'
  return [date, slug, base].filter(Boolean).join('-')
}

/** Drop a run from an Output card: its record, any selection and saved links pointing into it. */
export function withoutRun(card: Card, runId: string): Card {
  if (card.kind !== 'output') return card
  const run = card.data.runs.find((r) => r.id === runId)
  const files = new Set(run?.files ?? [])
  const saved = Object.fromEntries(Object.entries(card.data.saved).filter(([k]) => !files.has(k)))
  return { ...card, data: { runs: card.data.runs.filter((r) => r.id !== runId), selected: card.data.selected.filter((f) => !files.has(f)), saved } }
}

// ── IPC payloads ─────────────────────────────────────────────────────────────
export interface ImageRunInput { agent: ProviderId; model: string; prompt: string; refs: string[]; count: number }
export interface ImageRunDone { runId: string; files: string[]; error?: string }
export interface ImageRunEvent { runId: string; label: string }

export interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/**
 * Nearest position to `start` where a card of `size` doesn't overlap any of `taken`
 * (Hien, 2026-10-12: a new card used to land on top of whatever was in the middle).
 * Searches rings of `step` around the start, right/down first; gives up and returns
 * `start` after `maxRings`.
 */
export function findFreeSpot(taken: Rect[], start: { x: number; y: number }, size: { w: number; h: number }, step = 40, maxRings = 25, gap = 24): { x: number; y: number } {
  const free = (x: number, y: number) => !taken.some((t) => overlaps({ x, y, w: size.w, h: size.h }, t, gap))
  if (free(start.x, start.y)) return start
  for (let r = 1; r <= maxRings; r++) {
    const cands: { x: number; y: number; d: number }[] = []
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue
      // prefer right, then down: small bias so ties break toward reading order
      cands.push({ x: start.x + i * step, y: start.y + j * step, d: Math.hypot(i, j) - (i > 0 ? 0.01 : 0) - (j > 0 ? 0.005 : 0) })
    }
    cands.sort((a, b) => a.d - b.d)
    for (const c of cands) if (free(c.x, c.y)) return { x: c.x, y: c.y }
  }
  return start
}

// ── Multiple canvases (D-102) ────────────────────────────────────────────────
// canvases/index.json = the tab list + the active tab; canvases/<id>.json = one canvas.
// The old single canvas.json becomes the first tab on first open (imageService).
export const CANVASES_DIR = 'canvases'
export const CANVAS_INDEX_FILE = 'index.json'

export interface CanvasTab { id: string; name: string }
export interface CanvasIndex { version: 1; tabs: CanvasTab[]; active: string }

const cleanName = (n: unknown): string => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 60) : '')
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{3,40}$/i.test(id)

/** "Canvas N" with the lowest N not already used. */
export function nextCanvasName(tabs: CanvasTab[]): string {
  const used = new Set(tabs.map((t) => t.name.toLowerCase()))
  let n = 1
  while (used.has(`canvas ${n}`)) n++
  return `Canvas ${n}`
}

/** Parse index.json; drops bad entries and duplicate ids, keeps `active` pointing at a real tab. */
export function parseCanvasIndex(raw: string | null | undefined): CanvasIndex | null {
  let j: any
  try { j = JSON.parse(raw ?? '') } catch { return null }
  if (!j || !Array.isArray(j.tabs)) return null
  const seen = new Set<string>()
  const tabs: CanvasTab[] = []
  for (const t of j.tabs) {
    if (!t || !validId(t.id) || seen.has(t.id)) continue
    seen.add(t.id)
    tabs.push({ id: t.id, name: cleanName(t.name) || nextCanvasName(tabs) })
  }
  if (!tabs.length) return null
  return { version: 1, tabs, active: tabs.some((t) => t.id === j.active) ? j.active : tabs[0].id }
}

export const isCanvasId = validId

export function addTab(ix: CanvasIndex, id: string, name?: string, after?: string): CanvasIndex {
  const tab = { id, name: cleanName(name) || nextCanvasName(ix.tabs) }
  const at = after ? ix.tabs.findIndex((t) => t.id === after) : -1
  const tabs = at >= 0 ? [...ix.tabs.slice(0, at + 1), tab, ...ix.tabs.slice(at + 1)] : [...ix.tabs, tab]
  return { ...ix, tabs, active: id }
}

export function renameTab(ix: CanvasIndex, id: string, name: string): CanvasIndex {
  const n = cleanName(name)
  if (!n) return ix
  return { ...ix, tabs: ix.tabs.map((t) => (t.id === id ? { ...t, name: n } : t)) }
}

/** Remove a tab; if it was active, the neighbour to its right (else left) becomes active. Never leaves zero tabs — the caller adds a fresh one. */
export function removeTab(ix: CanvasIndex, id: string): CanvasIndex {
  const i = ix.tabs.findIndex((t) => t.id === id)
  if (i < 0) return ix
  const tabs = ix.tabs.filter((t) => t.id !== id)
  const active = ix.active !== id ? ix.active : (tabs[i] ?? tabs[i - 1])?.id ?? ''
  return { ...ix, tabs, active }
}

/** "Name copy", "Name copy 2", … */
export function copyName(tabs: CanvasTab[], name: string): string {
  const used = new Set(tabs.map((t) => t.name.toLowerCase()))
  let n = `${name} copy`.slice(0, 60)
  for (let k = 2; used.has(n.toLowerCase()); k++) n = `${name} copy ${k}`.slice(0, 60)
  return n
}

/**
 * Record a finished run on its canvas: append it to every Output fed by the processor, or
 * create and connect an Output when there is none. Pure, so the same code updates the
 * canvas on screen or one loaded from disk (a run that finishes after you switched tabs).
 */
export function applyRunResult(c: Canvas, processorId: string, rec: Omit<RunRecord, 'agent' | 'model'>, outputX = 360): Canvas {
  const p = c.cards.find((k) => k.id === processorId)
  if (!p || p.kind !== 'processor') return c
  const full: RunRecord = { ...rec, agent: p.data.agent, model: p.data.model }
  let next = c
  let outs = outputsOf(next, processorId)
  if (!outs.length) {
    const o = makeCard('output', p.x + outputX, p.y)
    next = connect({ ...next, cards: [...next.cards, o] }, processorId, o.id, OUTPUT_SLOT)
    outs = [o]
  }
  for (const o of outs) next = updateCard(next, o.id, (k) => (k.kind === 'output' ? { ...k, data: { ...k.data, runs: [...k.data.runs, full].slice(-30) } } : k))
  return next
}
