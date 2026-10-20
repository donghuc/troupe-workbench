// Voice input in the window (D-124): record with the microphone, decode to 16 kHz mono,
// hand the PCM to main for whisper.cpp. Also the one shortcut, shared by every composer.
import { api } from './api'
import { toPcm16, VOICE_SAMPLE_RATE, type VoiceStatus, type VoiceDownloadEvent } from '../../shared/voice'
import { IS_WINDOWS, OS_WORDS } from '../../shared/platform'

export const VOICE_SHORTCUT_LABEL = `${OS_WORDS.mod}${OS_WORDS.shift}Space`
/** ⌘⇧Space (Ctrl+Shift+Space on Windows) starts and stops voice input. */
const isVoiceShortcut = (e: KeyboardEvent): boolean =>
  e.code === 'Space' && e.shiftKey && !e.altKey && (IS_WINDOWS ? e.ctrlKey && !e.metaKey : e.metaKey && !e.ctrlKey)

// ---- status (which model is ready), shared by every mic button ----
let status: VoiceStatus | null = null
const listeners = new Set<(s: VoiceStatus) => void>()
export async function refreshVoiceStatus(): Promise<VoiceStatus> {
  const s: VoiceStatus = await api.voice.status()
  status = s
  for (const l of listeners) l(s)
  return s
}
export function onVoiceStatus(cb: (s: VoiceStatus) => void): () => void {
  listeners.add(cb)
  if (status) cb(status); else void refreshVoiceStatus().catch(() => {})
  return () => { listeners.delete(cb) }
}
let wired = false
function wireDownloads(): void {
  if (wired) return
  wired = true
  api.voice.onEvent((e: VoiceDownloadEvent) => { if (e.state !== 'downloading') void refreshVoiceStatus().catch(() => {}) })
}

// ---- recording ----
export interface Recording {
  /** Stop and return 16 kHz mono 16-bit PCM. */
  finish(): Promise<ArrayBuffer>
  /** Stop and throw the audio away. */
  discard(): void
}

export async function startRecording(): Promise<Recording> {
  const access = await api.voice.micAccess()
  if (access === 'denied' || access === 'restricted') {
    throw new Error(IS_WINDOWS
      ? 'Troupe can’t use the microphone. Allow it in Settings ▸ Privacy & security ▸ Microphone (“Let desktop apps access your microphone”).'
      : 'Troupe can’t use the microphone. Allow it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve() })
  rec.start(1000)
  const end = () => { if (rec.state !== 'inactive') rec.stop(); stream.getTracks().forEach((t) => t.stop()) }
  return {
    async finish() {
      end()
      await stopped
      return decodeToPcm(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer())
    },
    discard() { end(); chunks.length = 0 }
  }
}

/** Any recording Chromium can decode → 16 kHz mono PCM (decodeAudioData resamples to the context's rate). */
async function decodeToPcm(data: ArrayBuffer): Promise<ArrayBuffer> {
  if (!data.byteLength) return new ArrayBuffer(0)
  const ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
  try {
    const buf = await ctx.decodeAudioData(data)
    const mono = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c)
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels
    }
    return toPcm16(mono)
  } finally { void ctx.close() }
}

// ---- which composer the shortcut talks to ----
// Several composers can be on screen (project home, chat, side panes). The shortcut goes to
// the one you last typed in, or the newest one if you haven't focused any.
interface Target { toggle: () => void; cancel: () => boolean }
const targets: { id: number; t: Target }[] = []
let lastFocused = -1
let nextId = 1
let keysWired = false
function wireKeys(): void {
  if (keysWired) return
  keysWired = true
  window.addEventListener('keydown', (e) => {
    if (isVoiceShortcut(e)) {
      const target = targets.find((x) => x.id === lastFocused) ?? targets[targets.length - 1]
      if (!target) return
      e.preventDefault()
      target.t.toggle()
    } else if (e.key === 'Escape') {
      // Esc discards a recording, wherever focus is.
      if (targets.some((x) => x.t.cancel())) { e.preventDefault(); e.stopPropagation() }
    }
  }, true)
}
export function registerVoiceTarget(t: Target): { focus: () => void; remove: () => void } {
  wireKeys(); wireDownloads()
  const id = nextId++
  targets.push({ id, t })
  return {
    focus: () => { lastFocused = id },
    remove: () => { const i = targets.findIndex((x) => x.id === id); if (i >= 0) targets.splice(i, 1); if (lastFocused === id) lastFocused = -1 }
  }
}
