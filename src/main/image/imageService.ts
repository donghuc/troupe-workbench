// Image canvas, main side (D-088). The canvas lives as canvas.json in one global Image
// folder (setting `image_folder`); pasted/uploaded references are copied into inputs/,
// each run writes outputs/run-<id>/. A run is a direct provider run of one image-capable
// agent (Codex / Grok / Gemini) with the prompt contract from shared/imageCanvas.ts —
// the agents aren't image APIs, so after the run we collect what they actually saved.
import { promises as fsp, existsSync, statSync, readFileSync } from 'fs'
import { join, resolve, relative, sep, extname, basename, isAbsolute } from 'path'
import { createHash } from 'crypto'
import { homedir } from 'os'
import type { WebContents } from 'electron'
import { getSetting, setSetting } from '../database/settingsRepo'
import { createProvider } from '../providers/registry'
import type { AgentProvider } from '../providers/AgentProvider'
import { ensureInside } from '../filesystem/fsService'
import { logInfo, logError } from '../util/logger'
import { mcpOffFor, MCP_OFF_SETTING } from '../../shared/projectMcp'
import { codexServerNames, codexDefaultModel } from '../tools/codexConfig'
import { DISABLED_AGENTS_SETTING, enabledProviderIds, agentEntry } from '../../shared/providers'
import { IPC } from '../../shared/ipc'
import {
  IMAGE_FOLDER_SETTING, CANVAS_FILE, INPUTS_DIR, OUTPUTS_DIR, SAVED_DIR, HISTORY_DIR, savedName, emptyCanvas, parseCanvas, newId,
  CANVASES_DIR, CANVAS_INDEX_FILE, parseCanvasIndex, nextCanvasName, addTab, renameTab, removeTab, copyName, isCanvasId, type CanvasIndex,
  buildImagePrompt, isImageAgent, isVectorAgent, isSelfSavingAgent, isImagePath, imagePathsInReply,
  type Canvas, type ImageRunInput, type ImageRunDone, type ImageRunEvent
} from '../../shared/imageCanvas'

const RUN_TIMEOUT_MS = 10 * 60 * 1000
const MAX_FILES = 8

const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/')
const isUnder = (root: string, abs: string) => { const r = resolve(root); const a = resolve(abs); return a === r || a.startsWith(r + sep) }

// ── Folder ───────────────────────────────────────────────────────────────────
export function getImageFolder(): string | null {
  const p = (getSetting(IMAGE_FOLDER_SETTING) || '').trim()
  if (!p) return null
  try { return statSync(p).isDirectory() ? p : null } catch { return null }
}

export function setImageFolder(p: string): string {
  if (!isAbsolute(p) || !statSync(p).isDirectory()) throw new Error('Not a folder')
  setSetting(IMAGE_FOLDER_SETTING, p)
  logInfo('[image] folder set', { folder: p })
  return p
}

function requireFolder(): string {
  const f = getImageFolder()
  if (!f) throw new Error('Connect a folder for Image first')
  return f
}

// ── Canvases (D-102: several canvases, one file each) ───────────────────────
// canvases/index.json holds the tab list and the active tab; canvases/<id>.json one canvas.
// Writes go through a temp file + rename; index changes are serialised.
const writeJson = async (abs: string, data: unknown) => {
  const tmp = `${abs}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rename(tmp, abs)
}
const canvasPath = (f: string, id: string) => {
  if (!isCanvasId(id)) throw new Error('Not a canvas')
  return ensureInside(f, `${CANVASES_DIR}/${id}.json`)
}
let indexChain: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const r = indexChain.then(fn, fn); indexChain = r.catch(() => {}); return r }

/** The tab list. First open: the old single canvas.json becomes "Canvas 1" (moved, not copied). */
async function readIndex(f: string): Promise<CanvasIndex> {
  const dir = join(f, CANVASES_DIR)
  const ixPath = join(dir, CANVAS_INDEX_FILE)
  try {
    const ix = parseCanvasIndex(await fsp.readFile(ixPath, 'utf8'))
    if (ix) return ix
  } catch { /* none yet */ }
  await fsp.mkdir(dir, { recursive: true })
  const id = newId('c')
  const legacy = join(f, CANVAS_FILE)
  if (existsSync(legacy)) {
    await fsp.rename(legacy, canvasPath(f, id))
    logInfo('[image] moved canvas.json into canvases/ as the first tab', { id })
  } else {
    await writeJson(canvasPath(f, id), emptyCanvas())
  }
  const ix: CanvasIndex = { version: 1, tabs: [{ id, name: nextCanvasName([]) }], active: id }
  await writeJson(ixPath, ix)
  return ix
}
const writeIndex = (f: string, ix: CanvasIndex) => writeJson(join(f, CANVASES_DIR, CANVAS_INDEX_FILE), ix)

export function canvasIndex(): Promise<CanvasIndex> {
  const f = requireFolder()
  return serial(() => readIndex(f))
}

export async function loadCanvas(id: string): Promise<Canvas> {
  const f = requireFolder()
  try { return parseCanvas(await fsp.readFile(canvasPath(f, id), 'utf8')) } catch { return emptyCanvas() }
}

export async function saveCanvas(id: string, c: Canvas): Promise<void> {
  const f = requireFolder()
  const ix = await canvasIndex()
  if (!ix.tabs.some((t) => t.id === id)) return   // a deleted canvas must not come back from a late autosave
  await writeJson(canvasPath(f, id), parseCanvas(JSON.stringify(c)))   // never write anything the loader would reject
}

async function snapshot(f: string, id: string, why: string): Promise<void> {
  const cur = canvasPath(f, id)
  if (!existsSync(cur)) return
  await fsp.mkdir(join(f, HISTORY_DIR), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fsp.copyFile(cur, join(f, HISTORY_DIR, `${why}-${id}-${stamp}.json`))
}

/** Clear one canvas to blank. The old one is kept in .history/; no image file is deleted. */
export async function clearCanvas(id: string): Promise<Canvas> {
  const f = requireFolder()
  await snapshot(f, id, 'cleared')
  const c = emptyCanvas()
  await writeJson(canvasPath(f, id), c)
  logInfo('[image] canvas cleared', { id })
  return c
}

export function setActiveCanvas(id: string): Promise<CanvasIndex> {
  const f = requireFolder()
  return serial(async () => {
    const ix = await readIndex(f)
    if (!ix.tabs.some((t) => t.id === id) || ix.active === id) return ix
    const next = { ...ix, active: id }
    await writeIndex(f, next)
    return next
  })
}

export function createCanvas(after?: string): Promise<CanvasIndex> {
  const f = requireFolder()
  return serial(async () => {
    const ix = await readIndex(f)
    const id = newId('c')
    await writeJson(canvasPath(f, id), emptyCanvas())
    const next = addTab(ix, id, undefined, after ?? ix.active)
    await writeIndex(f, next)
    return next
  })
}

export function renameCanvas(id: string, name: string): Promise<CanvasIndex> {
  const f = requireFolder()
  return serial(async () => {
    const next = renameTab(await readIndex(f), id, name)
    await writeIndex(f, next)
    return next
  })
}

export function duplicateCanvas(id: string): Promise<CanvasIndex> {
  const f = requireFolder()
  return serial(async () => {
    const ix = await readIndex(f)
    const src = ix.tabs.find((t) => t.id === id)
    if (!src) return ix
    const copy = newId('c')
    let c = emptyCanvas()
    try { c = parseCanvas(await fsp.readFile(canvasPath(f, id), 'utf8')) } catch { /* empty */ }
    await writeJson(canvasPath(f, copy), c)
    const next = addTab(ix, copy, copyName(ix.tabs, src.name), id)
    await writeIndex(f, next)
    return next
  })
}

/** Delete one canvas (kept in .history/; images untouched). The last canvas is replaced by a blank one. */
export function deleteCanvas(id: string): Promise<CanvasIndex> {
  const f = requireFolder()
  return serial(async () => {
    const ix = await readIndex(f)
    if (!ix.tabs.some((t) => t.id === id)) return ix
    await snapshot(f, id, 'deleted')
    await fsp.rm(canvasPath(f, id), { force: true })
    let next = removeTab(ix, id)
    if (!next.tabs.length) {
      const fresh = newId('c')
      await writeJson(canvasPath(f, fresh), emptyCanvas())
      next = addTab({ ...next, tabs: [] }, fresh)
    }
    await writeIndex(f, next)
    logInfo('[image] canvas deleted', { id })
    return next
  })
}

// ── References ───────────────────────────────────────────────────────────────
/** Copy a pasted/uploaded image into inputs/; returns its path relative to the folder. */
export async function importMedia(base64: string, name: string): Promise<string> {
  const f = requireFolder()
  let ext = extname(name || '').toLowerCase()
  if (!isImagePath(`x${ext}`)) ext = '.png'
  const stem = (basename(name || 'image', extname(name || '')) || 'image').replace(/[^\w.-]+/g, '-').slice(0, 40) || 'image'
  const rel = `${INPUTS_DIR}/${stem}-${newId()}${ext}`
  const abs = ensureInside(f, rel)
  await fsp.mkdir(join(f, INPUTS_DIR), { recursive: true })
  await fsp.writeFile(abs, Buffer.from(base64, 'base64'))
  return rel
}

// ── Saved vs generated (Hien, 2026-10-05) ───────────────────────────────────
// outputs/ holds every run and is disposable; saved/ holds copies the user chose to keep,
// so deleting runs never touches what was saved.

/** Copy a generated image into saved/; returns the saved path (relative). */
export async function saveImage(rel: string, hint: string): Promise<string> {
  const f = requireFolder()
  const src = ensureInside(f, rel)
  if (!isImagePath(src) || !existsSync(src)) throw new Error('Image not found')
  await fsp.mkdir(join(f, SAVED_DIR), { recursive: true })
  const name = savedName(hint || '', rel)
  const ext = extname(name), stem = name.slice(0, name.length - ext.length)
  let dest = join(f, SAVED_DIR, name), n = 2
  while (existsSync(dest)) dest = join(f, SAVED_DIR, `${stem}-${n++}${ext}`)
  await fsp.copyFile(src, dest)
  logInfo('[image] saved', { from: rel, to: toRel(f, dest) })
  return toRel(f, dest)
}

/** Remove a saved copy (only files inside saved/). The generated original is untouched. */
export async function unsaveImage(savedRel: string): Promise<void> {
  const f = requireFolder()
  const abs = ensureInside(f, savedRel)
  if (!isUnder(join(f, SAVED_DIR), abs) || abs === resolve(join(f, SAVED_DIR))) throw new Error('Not a saved image')
  await fsp.rm(abs, { force: true })
}

/**
 * Delete one run's folder in outputs/. Saved copies live in saved/ and stay. A duplicated
 * canvas shares its runs' files (D-102), so the folder is kept while any other canvas
 * still lists that run; `fromCanvas` is the canvas removing it. Returns whether it was deleted.
 */
export async function deleteRun(runId: string, fromCanvas = ''): Promise<boolean> {
  const f = requireFolder()
  if (!/^run-[a-z0-9]+$/i.test(runId)) throw new Error('Not a run')
  const dir = ensureInside(f, `${OUTPUTS_DIR}/${runId}`)
  if (live.has(runId)) throw new Error('That run is still going')
  const needle = `${OUTPUTS_DIR}/${runId}/`
  const ix = await canvasIndex()
  for (const t of ix.tabs) {
    if (t.id === fromCanvas) continue
    try {
      if ((await fsp.readFile(canvasPath(f, t.id), 'utf8')).includes(needle)) { logInfo('[image] run kept — used by another canvas', { runId, canvas: t.id }); return false }
    } catch { /* missing canvas file */ }
  }
  await fsp.rm(dir, { recursive: true, force: true })
  logInfo('[image] run deleted', { runId })
  return true
}

// ── Runs ─────────────────────────────────────────────────────────────────────
const live = new Map<string, { provider: AgentProvider; cancelled: boolean }>()

const codexConfig = (): string => { try { return readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8') } catch { return '' } }
const codexServers = (): string[] => codexServerNames(codexConfig())

/**
 * The model a run really uses. Codex with "Default": the model in ~/.codex/config.toml,
 * passed explicitly — otherwise CodexProvider swaps in its chat image pin
 * (`codex_image_model`), which can name a model the account can't use (Hien, 2026-10-05:
 * gpt-6.1-sol → 400 "not supported when using Codex with a ChatGPT account"; gpt-6-astra
 * from his config works).
 */
function runModel(agent: string, model: string): string {
  if (model || agent !== 'codex') return model
  return codexDefaultModel(codexConfig())
}

/** Make the CLI's raw error readable, with what to do about it. */
function friendlyRunError(agent: string, model: string, msg: string): string {
  const m = /"message"\s*:\s*"([^"]+)"/.exec(msg)
  const text = m ? m[1] : msg
  if (/model is not supported|model_not_found|does not exist|not supported when using/i.test(text)) {
    return `${agentEntry(agent as Parameters<typeof agentEntry>[0]).label} can't use ${model ? `the model “${model}”` : 'its default model'} with your account. Pick another model on the Processor.`
  }
  return text
}

/** Fresh images anywhere in the folder (depth ≤ 4), except inputs/, outputs/ and .history/. */
async function freshImages(root: string, sinceMs: number): Promise<string[]> {
  const out: string[] = []
  const skip = new Set([INPUTS_DIR, OUTPUTS_DIR, SAVED_DIR, HISTORY_DIR, CANVASES_DIR, 'node_modules', '.git'])
  async function walk(dir: string, depth: number): Promise<void> {
    let entries
    try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (depth < 4 && !(dir === root && skip.has(e.name))) await walk(p, depth + 1) }
      else if (e.isFile() && isImagePath(e.name)) {
        try { if ((await fsp.stat(p)).mtimeMs > sinceMs) out.push(p) } catch { /* gone */ }
      }
    }
  }
  await walk(root, 0)
  return out
}

/**
 * Grok's image tool saves to ~/.grok/sessions/<encodeURIComponent(cwd)>/<session>/images/
 * (B-042). Read those directly, so images are collected even when the run times out or is
 * stopped before GrokProvider's own recovery runs (B-051).
 */
async function grokSessionImages(cwd: string, sinceMs: number): Promise<string[]> {
  const base = join(homedir(), '.grok', 'sessions', encodeURIComponent(cwd))
  const out: { f: string; m: number }[] = []
  let sessions: string[] = []
  try { sessions = await fsp.readdir(base) } catch { return [] }
  for (const s of sessions) {
    const dir = join(base, s, 'images')
    let files: string[] = []
    try { files = await fsp.readdir(dir) } catch { continue }
    for (const f of files) {
      if (!isImagePath(f)) continue
      try { const st = await fsp.stat(join(dir, f)); if (st.mtimeMs > sinceMs) out.push({ f: join(dir, f), m: st.mtimeMs }) } catch { /* gone */ }
    }
  }
  return out.sort((a, b) => a.m - b.m).map((x) => x.f)
}

const fileHash = async (p: string): Promise<string> => createHash('sha1').update(await fsp.readFile(p)).digest('hex')

/**
 * Gather what the agent made into outDir. Preferred: files it saved in outDir as asked.
 * Fallback, only when outDir is empty (so parallel runs don't take each other's images):
 * images it reported (file_changed / paths in the reply) or that appeared in the folder
 * during the run. Ones inside the folder are moved (keeps generated/ tidy), ones outside
 * (an agent's own cache) are copied. References in inputs/ are never touched.
 */
async function collect(root: string, outDir: string, sinceMs: number, reported: string[], reply: string, agent: string): Promise<string[]> {
  const inOut = async () => {
    try { return (await fsp.readdir(outDir)).filter(isImagePath).sort().map((n) => join(outDir, n)) } catch { return [] }
  }
  let files = await inOut()
  if (!files.length) {
    const cands = new Set<string>()
    const add = (p: string) => {
      const abs = isAbsolute(p) ? p : resolve(root, p)
      if (!isImagePath(abs) || [INPUTS_DIR, OUTPUTS_DIR, SAVED_DIR].some((d) => isUnder(join(root, d), abs))) return
      try { if (statSync(abs).isFile() && statSync(abs).mtimeMs > sinceMs - 2000) cands.add(abs) } catch { /* missing */ }
    }
    if (agent === 'grok') (await grokSessionImages(root, sinceMs)).forEach(add)
    reported.forEach(add)
    imagePathsInReply(reply).forEach(add)
    ;(await freshImages(root, sinceMs)).forEach(add)
    await fsp.mkdir(outDir, { recursive: true })
    let i = 0
    const seen = new Set<string>()   // the same image can arrive twice (Grok original + its recovered copy)
    for (const src of [...cands]) {
      if (i >= MAX_FILES) break
      let h = ''
      try { h = await fileHash(src) } catch { continue }
      if (seen.has(h)) { if (isUnder(root, src) && isUnder(join(root, 'generated'), src)) await fsp.rm(src, { force: true }).catch(() => {}); continue }
      seen.add(h)
      i++
      const dest = join(outDir, `image-${i}${extname(src).toLowerCase() || '.png'}`)
      try {
        if (isUnder(root, src)) await fsp.rename(src, dest)
        else await fsp.copyFile(src, dest)
        logInfo('[image] collected', { from: src, to: dest })
      } catch (e) { logError('[image] collect failed', String(e)) }
    }
    files = await inOut()
  }
  return files.slice(0, MAX_FILES).map((abs) => toRel(root, abs))
}

function send(sender: WebContents, channel: string, payload: unknown) {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

export function startImageRun(sender: WebContents, input: ImageRunInput): string {
  const root = requireFolder()
  if (!isImageAgent(input.agent)) throw new Error('This agent can’t make images')
  if (!enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(input.agent)) throw new Error(`${agentEntry(input.agent).label} is turned off in Settings ▸ Agents.`)
  if (!input.prompt?.trim()) throw new Error('The prompt is empty')
  const refs = (input.refs ?? []).filter((r) => typeof r === 'string')
  const refAbs = refs.map((r) => ensureInside(root, r)).filter((p) => existsSync(p))
  const provider = createProvider(input.agent)
  if (!provider) throw new Error('Agent not available')

  const runId = newId('run-')
  const outRel = `${OUTPUTS_DIR}/${runId}`
  const outDir = ensureInside(root, outRel)
  const model = runModel(input.agent, input.model || '')
  const prompt = buildImagePrompt({ prompt: input.prompt, refs: refAbs.map((a) => toRel(root, a)), count: input.count, outDir: outRel, vector: isVectorAgent(input.agent), selfSaving: isSelfSavingAgent(input.agent) })
  const mcpOff = [...new Set([...mcpOffFor(getSetting(MCP_OFF_SETTING), input.agent), ...(input.agent === 'codex' ? codexServers() : [])])]
  const entry = { provider, cancelled: false }
  live.set(runId, entry)
  const ev = (label: string) => send(sender, IPC.imageEvent, { runId, label } satisfies ImageRunEvent)
  const done = (d: Omit<ImageRunDone, 'runId'>) => { live.delete(runId); send(sender, IPC.imageDone, { runId, ...d } satisfies ImageRunDone) }

  void (async () => {
    const since = Date.now()
    const reported: string[] = []
    let reply = ''
    let fatal = ''
    const timer = setTimeout(() => { fatal = 'Timed out after 10 minutes'; void provider.cancel() }, RUN_TIMEOUT_MS)
    logInfo('[image] run start', { runId, agent: input.agent, model: model || 'default', refs: refAbs.length, count: input.count })
    try {
      await fsp.mkdir(outDir, { recursive: true })
      ev('Starting…')
      for await (const e of provider.run({
        prompt, context: {}, cwd: root, model: model || undefined, permissionMode: 'auto', mcpOff, images: refAbs.filter((a) => !/\.svg$/i.test(a)), toolProfile: 'image'
      })) {
        if (e.type === 'text_delta') reply += e.text
        else if (e.type === 'status') ev(e.message)
        else if (e.type === 'tool_start') ev(`Running ${e.tool}…`)
        else if (e.type === 'file_changed') { reported.push(e.path); if (isImagePath(e.path)) ev('Saving image…') }
        else if (e.type === 'error' && e.fatal) fatal = fatal || e.message
      }
    } catch (e) {
      fatal = fatal || (e instanceof Error ? e.message : String(e))
    } finally { clearTimeout(timer) }
    if (entry.cancelled) { done({ files: [], error: 'Stopped' }); return }
    ev('Collecting images…')
    let files: string[] = []
    try { files = await collect(root, outDir, since, reported, reply, input.agent) } catch (e) { logError('[image] collect', String(e)) }
    if (!files.length) {
      try { if (!(await fsp.readdir(outDir)).length) await fsp.rmdir(outDir) } catch { /* keep */ }
      const said = reply.trim().replace(/\s+/g, ' ').slice(0, 280)
      const error = (fatal && friendlyRunError(input.agent, model, fatal)) || `${agentEntry(input.agent).label} finished without saving an image.${said ? ` It said: “${said}”` : ''}`
      logInfo('[image] run produced nothing', { runId, error })
      done({ files: [], error })
      return
    }
    logInfo('[image] run done', { runId, files: files.length, secs: Math.round((Date.now() - since) / 1000) })
    done({ files, ...(fatal ? { error: fatal } : {}) })
  })()
  return runId
}

export async function cancelImageRun(runId: string): Promise<void> {
  const r = live.get(runId)
  if (!r) return
  r.cancelled = true
  await r.provider.cancel()
}

export async function cancelAllImageRuns(): Promise<void> {
  for (const id of [...live.keys()]) await cancelImageRun(id)
}
