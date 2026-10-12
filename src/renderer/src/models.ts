import type { ProviderId } from '../../shared/types'
import { presetsFor as presetsForShared, modelForProvider as modelForShared, parseExtraModels, modelListFor, EXTRA_MODELS_SETTING, type ModelPreset, type ModelLists } from '../../shared/models'
import { api } from './api'

// Renderer wrapper over shared/models.ts (D-061): keeps the live model lists in module
// state so the pickers update as soon as Settings saves.

// Per agent: its own newest models (Codex reads ~/.codex/models_cache.json in main — D-076)
// merged with the global "More models" lines (D-078).
let auto: ModelLists = {}
let typed: ModelLists = {}
let lists: ModelLists = {}
const remerge = () => { lists = { ...typed, codex: modelListFor(auto.codex ?? [], typed.codex), gemini: modelListFor(auto.gemini ?? [], typed.gemini) } }
export function setExtraModels(raw: string | null): void { typed = parseExtraModels(raw); remerge() }
export function setAutoModels(l: ModelLists): void { auto = l; remerge() }
export async function loadModelLists(): Promise<void> {
  const [a, raw] = await Promise.all([
    api.system.autoModels().catch(() => ({} as ModelLists)),
    api.settings.get(EXTRA_MODELS_SETTING).catch(() => null)
  ])
  auto = a; typed = parseExtraModels(raw); remerge()
}
// Models switched off in Settings ▸ Agents (D-072); kept current by agents.ts.
let disabledModels: ReadonlySet<string> = new Set()
export function setDisabledModelsState(keys: ReadonlySet<string>): void { disabledModels = keys }
export const disabledModelSet = (): ReadonlySet<string> => disabledModels
export const modelLists = (): ModelLists => lists

export const presetsFor = (id: ProviderId): ModelPreset[] => presetsForShared(id, lists, disabledModels)
