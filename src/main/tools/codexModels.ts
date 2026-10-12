import { readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getSetting, setSetting } from '../database/settingsRepo'
import { parseCodexModelsCache, parseExtraModels, modelListFor, migrateCodexModels, EXTRA_MODELS_SETTING, type ModelPreset, type ModelLists } from '../../shared/models'
import { logInfo } from '../util/logger'
import { geminiAutoModels } from './geminiModels'

// Codex's own model list (D-076), read-only from ~/.codex/models_cache.json and
// re-read only when the file changes. Missing or unreadable → [] (the typed list still works).
const CACHE_PATH = join(homedir(), '.codex', 'models_cache.json')
let memo: { mtimeMs: number; list: ModelPreset[] } | null = null

export function codexAutoModels(): ModelPreset[] {
  try {
    const { mtimeMs } = statSync(CACHE_PATH)
    if (memo?.mtimeMs !== mtimeMs) memo = { mtimeMs, list: parseCodexModelsCache(readFileSync(CACHE_PATH, 'utf8')) }
    return memo.list
  } catch { memo = null; return [] }
}

/** Every agent's extra models (D-078): the typed "More models" lines, plus — for agents
 *  whose CLI lists its models — that agent's newest few (LATEST_MODELS). */
export function modelLists(): ModelLists {
  const typed = parseExtraModels(getSetting(EXTRA_MODELS_SETTING))
  return { ...typed, codex: modelListFor(codexAutoModels(), typed.codex), gemini: modelListFor(geminiAutoModels(), typed.gemini) }
}

/** D-078: the Codex-only "More models" field became global. Runs once (while the new
 *  setting has never been written); the old `codex_models` key is left in place, unread. */
export function migrateExtraModels(): void {
  if (getSetting(EXTRA_MODELS_SETTING) !== null) return
  const text = migrateCodexModels(getSetting('codex_models'))
  setSetting(EXTRA_MODELS_SETTING, text)
  if (text) logInfo('moved Codex "More models" into the global list')
}
