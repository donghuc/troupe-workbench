// Voice input (D-124): model downloads and transcription, in main. The window records,
// converts to 16 kHz 16-bit PCM and sends it here; nothing leaves the computer except the
// one-time model download from Hugging Face.
import { createHash } from 'crypto'
import { createWriteStream, promises as fsp } from 'fs'
import { cpus } from 'os'
import { join } from 'path'
import {
  VOICE_MODELS, DEFAULT_VOICE_MODEL, voiceModelUrl, voiceLanguage,
  VOICE_MAX_BYTES, VOICE_MODEL_SETTING, VOICE_LANGUAGE_SETTING, VOICE_SPEED_SETTING, per20s, type VoiceModel, type VoiceModelId, type VoiceDownloadEvent, type VoiceStatus, type VoiceResult
} from '../../shared/voice'

/** The part of @fugood/whisper.node we use (loaded lazily: it's a native module). */
export interface WhisperCtx {
  transcribeData(pcm: ArrayBuffer, opts: { language?: string; temperature?: number; maxThreads?: number }): { stop: () => Promise<void>; promise: Promise<{ result: string; language?: string; isAborted: boolean }> }
  release(): Promise<void>
  /** Set by the loader: whether this context runs on the graphics card. */
  backend?: 'gpu' | 'cpu'
}
export interface VoiceDeps {
  dir: string
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  initWhisper: (modelPath: string) => Promise<WhisperCtx>
  getSetting: (key: string) => string | null
  setSetting?: (key: string, value: string) => void
  /** The system's language ("vi-VN"), used until you pick a dictation language. */
  systemLocale?: () => string
  emit: (e: VoiceDownloadEvent) => void
  /** Release the loaded model after this long unused (it holds a few hundred MB). */
  idleMs?: number
  /** Timing lines for main.log. */
  log?: (msg: string, data: Record<string, unknown>) => void
  /** For tests: a different catalog. */
  models?: readonly VoiceModel[]
}

// Loading a model takes a moment (more for Best), so it stays loaded a while after use.
const IDLE_MS = 15 * 60_000

export function createVoiceService(deps: VoiceDeps) {
  const catalog = deps.models ?? VOICE_MODELS
  const find = (id: string | null | undefined) => catalog.find((m) => m.id === id)
  const downloads = new Map<VoiceModelId, { ctl: AbortController; received: number }>()
  let loaded: { path: string; ctx: WhisperCtx } | null = null
  let loading: Promise<WhisperCtx> | null = null
  let current: { stop: () => Promise<void> } | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let idle: ReturnType<typeof setTimeout> | null = null
  let backend: 'gpu' | 'cpu' | null = null

  // How long this computer takes per second of speech, per model (shown in Settings).
  const speeds = (): Record<string, number> => { try { return JSON.parse(deps.getSetting(VOICE_SPEED_SETTING) ?? '{}') ?? {} } catch { return {} } }
  const recordSpeed = (id: string, msPerSec: number) => {
    if (!deps.setSetting || !Number.isFinite(msPerSec) || msPerSec < 0) return
    deps.setSetting(VOICE_SPEED_SETTING, JSON.stringify({ ...speeds(), [id]: Math.max(1, Math.round(msPerSec)) }))
  }

  const pathOf = (m: VoiceModel) => join(deps.dir, m.file)
  const installed = async (m: VoiceModel): Promise<boolean> => {
    try { return (await fsp.stat(pathOf(m))).size === m.bytes } catch { return false }
  }

  async function status(): Promise<VoiceStatus> {
    const sel = find(deps.getSetting(VOICE_MODEL_SETTING))?.id ?? (find(DEFAULT_VOICE_MODEL) ?? catalog[0]).id
    const sp = speeds()
    const models = await Promise.all(catalog.map(async (m) => ({
      id: m.id, label: m.label, bytes: m.bytes, note: m.note,
      installed: await installed(m), downloading: downloads.has(m.id), received: downloads.get(m.id)?.received ?? 0,
      secPer20s: typeof sp[m.id] === 'number' ? per20s(sp[m.id]) : null
    })))
    const active = models.find((m) => m.id === sel && m.installed)?.id ?? models.find((m) => m.installed)?.id ?? null
    return { models, selected: sel, active, language: voiceLanguage(deps.getSetting(VOICE_LANGUAGE_SETTING), deps.systemLocale?.() ?? ''), folder: deps.dir, backend }
  }

  /** Download a model to `<file>.part`, check its SHA-256, then move it into place. */
  async function download(id: VoiceModelId): Promise<void> {
    const m = find(id)
    if (!m) throw new Error(`Unknown voice model: ${id}`)
    if (downloads.has(m.id) || (await installed(m))) return
    const ctl = new AbortController()
    const job = { ctl, received: 0 }
    downloads.set(m.id, job)
    const part = pathOf(m) + '.part'
    const report = (state: VoiceDownloadEvent['state'], error?: string) => deps.emit({ id: m.id, state, received: job.received, total: m.bytes, error })
    try {
      await fsp.mkdir(deps.dir, { recursive: true })
      const res = await deps.fetch(voiceModelUrl(m), { signal: ctl.signal })
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
      const hash = createHash('sha256')
      const out = createWriteStream(part)
      let last = 0
      try {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          hash.update(value)
          if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
          job.received += value.byteLength
          if (Date.now() - last > 250) { last = Date.now(); report('downloading') }
        }
      } finally {
        await new Promise<void>((r) => out.end(r))
      }
      if (job.received !== m.bytes || hash.digest('hex') !== m.sha256) throw new Error('The downloaded file is damaged or incomplete. Try again.')
      await fsp.rename(part, pathOf(m))
      report('done')
    } catch (e) {
      await fsp.rm(part, { force: true }).catch(() => {})
      if (ctl.signal.aborted) report('cancelled')
      else { report('error', e instanceof Error ? e.message : String(e)); throw e }
    } finally {
      downloads.delete(m.id)
    }
  }

  function cancelDownload(id: VoiceModelId): void { downloads.get(id)?.ctl.abort() }

  async function release(): Promise<void> {
    if (idle) { clearTimeout(idle); idle = null }
    const l = loaded; loaded = null
    if (l) await l.ctx.release().catch(() => {})
  }

  async function remove(id: VoiceModelId): Promise<void> {
    const m = find(id)
    if (!m) return
    cancelDownload(m.id)
    if (loaded?.path === pathOf(m)) await release()
    await fsp.rm(pathOf(m), { force: true })
  }

  async function contextFor(path: string): Promise<WhisperCtx> {
    if (loaded?.path === path) return loaded.ctx
    if (loading) await loading.catch(() => {})
    if (loaded?.path === path) return loaded.ctx
    await release()
    loading = deps.initWhisper(path)
    try { const ctx = await loading; loaded = { path, ctx }; backend = ctx.backend ?? backend; return ctx } finally { loading = null }
  }

  const keepWarm = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => { void release() }, deps.idleMs ?? IDLE_MS)
  }

  /** Load the model in the background when recording starts, so it's ready when you stop. */
  async function prepare(): Promise<void> {
    const m = find((await status()).active)
    if (!m) return
    const t0 = Date.now()
    const was = loaded?.path === pathOf(m)
    await contextFor(pathOf(m)).then(() => { keepWarm(); if (!was) deps.log?.('voice: model ready', { model: m.id, loadMs: Date.now() - t0 }) }).catch(() => {})
  }

  /** Transcribe one recording (16 kHz mono s16le). One at a time; the model stays loaded for a while. */
  function transcribe(input: ArrayBuffer | ArrayBufferView): Promise<VoiceResult> {
    // IPC may hand over a Buffer/Uint8Array instead of the ArrayBuffer the window sent.
    const pcm: unknown = ArrayBuffer.isView(input) ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input
    if (!(pcm instanceof ArrayBuffer) || pcm.byteLength < 2) return Promise.reject(new Error('No audio was recorded.'))
    if (pcm.byteLength > VOICE_MAX_BYTES) return Promise.reject(new Error('The recording is longer than 10 minutes.'))
    const run = async (): Promise<VoiceResult> => {
      const st = await status()
      const m = find(st.active)
      if (!m) throw new Error('No voice model yet: download one in Settings ▸ Tools ▸ Voice.')
      const t0 = Date.now()
      const ctx = await contextFor(pathOf(m))
      const loadMs = Date.now() - t0
      if (idle) { clearTimeout(idle); idle = null }
      const job = ctx.transcribeData(pcm, { language: st.language, temperature: 0, maxThreads: Math.max(1, Math.min(8, cpus().length - 1)) })
      current = job
      try {
        const r = await job.promise
        const ms = Date.now() - t0
        const audioSec = pcm.byteLength / 32_000
        deps.log?.('voice: transcribed', { model: m.id, backend, audioSec: Math.round(audioSec * 10) / 10, loadMs, ms, language: st.language, aborted: r.isAborted })
        if (r.isAborted) return { text: '', ms }
        if (audioSec >= 3) recordSpeed(m.id, (ms - loadMs) / audioSec)
        return { text: r.result ?? '', language: r.language, ms }
      } finally {
        current = null
        keepWarm()
      }
    }
    const p = queue.then(run, run)
    queue = p.catch(() => {})
    return p
  }

  async function cancel(): Promise<void> { await current?.stop().catch(() => {}) }

  return { status, download, cancelDownload, remove, prepare, transcribe, cancel, release }
}

export type VoiceService = ReturnType<typeof createVoiceService>
