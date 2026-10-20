// Voice input (D-124): speech to text in the composer, on this computer. whisper.cpp runs
// in main (@fugood/whisper.node); models are downloaded once from Hugging Face into
// userData/voice and checked against their SHA-256. Pure parts live here.

export type VoiceModelId = 'base' | 'small' | 'turbo'

export interface VoiceModel {
  id: VoiceModelId
  label: string
  file: string
  bytes: number
  sha256: string
  note: string
}

/** ggml whisper models from huggingface.co/ggerganov/whisper.cpp (sizes and hashes from its LFS metadata). */
export const VOICE_MODELS: readonly VoiceModel[] = [
  { id: 'base', label: 'Fast', file: 'ggml-base-q5_1.bin', bytes: 59_707_625, sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', note: 'Quickest; fine for English, weak on Vietnamese.' },
  { id: 'small', label: 'Balanced', file: 'ggml-small-q5_1.bin', bytes: 190_085_487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', note: 'Good for English and Vietnamese.' },
  { id: 'turbo', label: 'Best', file: 'ggml-large-v3-turbo-q5_0.bin', bytes: 574_041_195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', note: 'Most accurate, also for mixed languages; slower to load.' }
]
export const DEFAULT_VOICE_MODEL: VoiceModelId = 'small'
export const voiceModel = (id: string | null | undefined): VoiceModel | undefined => VOICE_MODELS.find((m) => m.id === id)
export const voiceModelUrl = (m: VoiceModel): string => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`

export const VOICE_MODEL_SETTING = 'voice_model'
export const VOICE_LANGUAGE_SETTING = 'voice_language'

/** Whisper language codes offered in Settings; 'auto' lets Whisper detect it per recording. */
export const VOICE_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' }
]
export const voiceLanguage = (v: string | null | undefined): string => (VOICE_LANGUAGES.some((l) => l.code === v) ? v! : 'auto')

/** Whisper wants 16 kHz mono. A recording is capped at 10 minutes. */
export const VOICE_SAMPLE_RATE = 16_000
export const VOICE_MAX_SECONDS = 600
export const VOICE_MAX_BYTES = VOICE_SAMPLE_RATE * 2 * VOICE_MAX_SECONDS

/** Float samples (−1…1) → signed 16-bit little-endian PCM, the format whisper.cpp takes. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out.buffer
}

// Whisper writes these for silence, noise and music instead of words.
const NOISE = /\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE|SOUND|APPLAUSE|LAUGHTER)[^\]]*\]|\((?:music|silence|noise|inaudible|applause|laughs?|laughter)[^)]*\)|♪+/gi

/** The text to insert: whisper's noise tags removed, whitespace tidied. Empty when nothing was said. */
export function cleanTranscript(raw: string): string {
  return raw.replace(NOISE, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

/** Put `insert` in place of text[start, end), with a space on each side where words would touch. */
export function insertAtCaret(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length))
  const e = Math.max(s, Math.min(end, text.length))
  if (!insert) return { text, caret: e }
  const before = text.slice(0, s)
  const after = text.slice(e)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : ''
  const piece = lead + insert + trail
  return { text: before + piece + after, caret: before.length + lead.length + insert.length }
}

/** "1:05" for the recording timer. */
export const formatElapsed = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

export const formatMb = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`

/** Download progress pushed to the window (`voice:download`). */
export interface VoiceDownloadEvent {
  id: VoiceModelId
  state: 'downloading' | 'done' | 'error' | 'cancelled'
  received: number
  total: number
  error?: string
}

export interface VoiceStatus {
  models: { id: VoiceModelId; label: string; bytes: number; note: string; installed: boolean; downloading: boolean; received: number }[]
  selected: VoiceModelId
  /** The model voice input will use: the selected one if it's on disk, else any installed one. */
  active: VoiceModelId | null
  language: string
  folder: string
}

export interface VoiceResult { text: string; language?: string; ms: number }
