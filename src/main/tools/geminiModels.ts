import { buildEnv } from '../providers/env'
import { execFileCli } from '../platform/proc'
import { parseAgyModels, type ModelPreset } from '../../shared/models'
import { logInfo } from '../util/logger'

// Gemini's model list (D-079), from `agy models`, which asks Google's servers — so it is
// cached for 30 minutes and refreshed in the background; a failure keeps the last list.
const TTL = 30 * 60_000
let cache: { at: number; list: ModelPreset[] } | null = null
let inflight: Promise<ModelPreset[]> | null = null

export function refreshGeminiModels(): Promise<ModelPreset[]> {
  if (inflight) return inflight
  if (process.platform === 'win32') return Promise.resolve([])   // Gemini is off on Windows (D-120)
  inflight = new Promise<ModelPreset[]>((resolve) => {
    execFileCli('agy', ['models'], { env: buildEnv(), timeout: 30000 }, (err, out) => {
      const list = err ? null : parseAgyModels(String(out))
      if (list && list.length) { cache = { at: Date.now(), list }; logInfo('[gemini] models', JSON.stringify(list.map((m) => m.v))) }
      inflight = null
      resolve(cache?.list ?? [])
    })
  })
  return inflight
}

/** The last known list; kicks off a refresh when it's older than TTL. Never blocks. */
export function geminiAutoModels(): ModelPreset[] {
  if (!cache || Date.now() - cache.at > TTL) void refreshGeminiModels()
  return cache?.list ?? []
}
