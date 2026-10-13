import type { ProviderId } from './types'
import { agentEntry, agentIds } from './providers'

export interface ModelPreset { v: string; l: string; note?: string }

// Static model presets per provider. '' means the provider's own default.
// Claude uses stable aliases that auto-track the latest tier. Agents whose CLI lists its
// models (Codex, D-076) get their newest few from that list; anything else is typed in the
// global "More models" field (D-078). Both arrive as `lists` (ModelLists) and are merged
// in by presetsFor(id, lists). Shared by main (D-061) and the renderer.
const MODEL_PRESETS: Record<string, ModelPreset[]> = {
  'claude-code': [
    { v: '', l: 'Default' },
    { v: 'opus', l: 'Opus' },
    { v: 'sonnet', l: 'Sonnet' },
    { v: 'fable', l: 'Fable' }
    // 'opusplan' deliberately absent: that alias means "Opus in plan mode, Sonnet
    // otherwise", and headless -p has no plan mode, so it always ran Sonnet (Hien, 2026-09-21).
    // Haiku left out of the defaults (D-078: three per agent) — add "claude: haiku" in More models.
  ],
  'codex': [{ v: '', l: 'Default' }],
  'grok': [{ v: '', l: 'Default' }],
  'gemini': [{ v: '', l: 'Default' }]
}

// Parse the `codex_models` setting: one model per line, `id` or `id | Label`
// (also accepts `id: Label`). Blank lines and duplicates of Default are ignored.
function parseCodexModels(raw: string | null | undefined): ModelPreset[] {
  if (!raw) return []
  const out: ModelPreset[] = []
  const seen = new Set<string>()
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(/^([^|:]+?)\s*[|:]\s*(.+)$/)
    const v = (m ? m[1] : t).trim()
    const l = (m ? m[2] : t).trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push({ v, l })
  }
  return out
}

// ── Codex's own model list (D-076) ───────────────────────────────────────────
// Codex keeps the models your account can use in ~/.codex/models_cache.json (refreshed
// by the CLI). Only models it lists in its own picker (visibility "list") are offered,
// in its order (priority). A model being retired carries Codex's migration note.
export function parseCodexModelsCache(raw: string | null | undefined): ModelPreset[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  const models = (data as { models?: unknown })?.models
  if (!Array.isArray(models)) return []
  type Entry = { slug?: unknown; display_name?: unknown; visibility?: unknown; priority?: unknown; upgrade?: { migration_markdown?: unknown } | null }
  const seen = new Set<string>()
  return (models as Entry[])
    .filter((m) => m && typeof m.slug === 'string' && m.slug && m.visibility === 'list')
    .sort((a, b) => (typeof a.priority === 'number' ? a.priority : 999) - (typeof b.priority === 'number' ? b.priority : 999))
    .flatMap((m) => {
      const v = m.slug as string
      if (seen.has(v)) return []
      seen.add(v)
      const note = typeof m.upgrade?.migration_markdown === 'string' ? m.upgrade.migration_markdown : undefined
      return [{ v, l: typeof m.display_name === 'string' && m.display_name ? m.display_name : v, ...(note ? { note } : {}) }]
    })
}

// Codex's list plus the ones typed in Settings. A typed entry with the same id renames
// it (its label wins); typed-only ids are added after Codex's own.
export function mergeCodexModels(auto: ModelPreset[], manual: ModelPreset[]): ModelPreset[] {
  const typed = new Map(manual.map((m) => [m.v, m]))
  const out = auto.map((m) => (typed.has(m.v) && typed.get(m.v)!.l !== m.v ? { ...m, l: typed.get(m.v)!.l } : m))
  const have = new Set(auto.map((m) => m.v))
  return [...out, ...manual.filter((m) => !have.has(m.v))]
}

// ── Model lists (D-078) ──────────────────────────────────────────────────────
// Per agent: the models that come from outside the static presets — the agent's own
// newest few (read from its CLI) merged with the ones typed in "More models".
export type ModelLists = Partial<Record<ProviderId, ModelPreset[]>>
/** How many of an agent's own models are offered by default (Hien, D-078). */
const LATEST_MODELS = 3
export const EXTRA_MODELS_SETTING = 'extra_models'

const agentByName = (name: string): ProviderId | null => {
  const n = name.trim().toLowerCase()
  return agentIds().find((id) => id === n || agentEntry(id).handle === n || agentEntry(id).label.toLowerCase() === n) ?? null
}

// The global "More models" field: one per line, `agent: model-id` or `agent: model-id | Label`,
// where agent is the @handle (claude, codex, …). Lines without a known agent are ignored.
export function parseExtraModels(raw: string | null | undefined): ModelLists {
  const out: ModelLists = {}
  for (const line of (raw ?? '').split('\n')) {
    const m = /^\s*([A-Za-z0-9-]+)\s*:\s*(.+)$/.exec(line)
    const id = m ? agentByName(m[1]) : null
    if (!m || !id) continue
    const [v, l] = m[2].split('|').map((x) => x.trim())
    if (!v) continue
    const list = (out[id] ??= [])
    if (!list.some((x) => x.v === v)) list.push({ v, l: l || v })
  }
  return out
}

/** Add one typed model for an agent to the "More models" text (Settings ▸ Agents ▸ Add model). */
export function addExtraModel(raw: string, id: ProviderId, model: string, label?: string): string {
  const v = model.trim()
  if (!v || /[|\n]/.test(v)) return raw
  if ((parseExtraModels(raw)[id] ?? []).some((m) => m.v === v)) return raw
  const l = label?.trim()
  const line = `${agentEntry(id).handle}: ${v}${l && l !== v ? ` | ${l}` : ''}`
  return raw.trim() ? `${raw.replace(/\s+$/, '')}\n${line}` : line
}

/** Remove a typed model from the "More models" text; other lines are kept as written. */
export function removeExtraModel(raw: string, id: ProviderId, model: string): string {
  return raw.split('\n').filter((line) => {
    const m = /^\s*([A-Za-z0-9-]+)\s*:\s*(.+)$/.exec(line)
    return !(m && agentByName(m[1]) === id && m[2].split('|')[0].trim() === model)
  }).join('\n')
}

// Gemini (D-079): `agy models` lists Gemini, Claude and GPT-OSS models, each Gemini one
// three times (…-high / -medium / -low effort). Troupe offers only Gemini, one entry per
// model, and only the newest version of each tier (Flash, Pro, …) — newest first.
//   gemini-3.8-flash-high   Gemini 3.8 Flash (High)   →  { v: 'gemini-3.8-flash', l: 'Gemini 3.8 Flash' }
export function parseAgyModels(raw: string | null | undefined): ModelPreset[] {
  const ver = (v: string) => v.split('.').map(Number)
  const newer = (a: string, b: string) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) } return false }
  const best = new Map<string, { version: string; v: string; l: string }>()
  for (const line of (raw ?? '').split('\n')) {
    const m = /^\s*(gemini-([\d.]+)-([a-z]+(?:-[a-z]+)*?))(?:-(?:high|medium|low))?\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const [, v, version, tier, label] = m
    const cur = best.get(tier)
    if (!cur || newer(version, cur.version)) best.set(tier, { version, v, l: label.replace(/\s*\((?:high|medium|low)\)\s*$/i, '') })
  }
  return [...best.values()].sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0)).map(({ v, l }) => ({ v, l }))
}

// D-078 migration: the old Codex-only field becomes `codex:` lines of the global one.
export const migrateCodexModels = (raw: string | null | undefined): string =>
  parseCodexModels(raw).map((m) => `codex: ${m.v}${m.l !== m.v ? ` | ${m.l}` : ''}`).join('\n')

/** An agent's own newest models (first LATEST_MODELS) merged with its typed extras. */
export const modelListFor = (auto: ModelPreset[], typed: ModelPreset[] = []): ModelPreset[] =>
  mergeCodexModels(auto.slice(0, LATEST_MODELS), typed)

// ── Turning models on/off (D-072) ────────────────────────────────────────────
// Setting: comma-separated "<providerId>:<model>" keys switched off in Settings ▸ Agents.
// An agent's Default ('') can't be switched off — it is what a disabled model falls back to.
export const DISABLED_MODELS_SETTING = 'disabled_models'
export const modelKey = (id: ProviderId, model: string): string => `${id}:${model}`
export function parseDisabledModels(raw: string | null | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]+:.+$/.test(s)))
}
export const serializeDisabledModels = (keys: Iterable<string>): string => [...new Set(keys)].filter(Boolean).sort().join(',')

/** All models an agent offers (Default first), before on/off filtering: its static
 *  presets, then its list (own newest + typed extras); a list entry with a preset's id
 *  renames it rather than duplicating it. */
export const allPresetsFor = (id: ProviderId, lists: ModelLists = {}): ModelPreset[] => {
  const base = MODEL_PRESETS[id] ?? [{ v: '', l: 'Default' }]
  return [base[0], ...mergeCodexModels(base.slice(1), lists[id] ?? [])]
}

/** Models offered in pickers: all presets minus the ones switched off (Default always stays). */
export const presetsFor = (id: ProviderId, lists: ModelLists = {}, disabled?: ReadonlySet<string>): ModelPreset[] =>
  allPresetsFor(id, lists).filter((m) => !m.v || !disabled?.has(modelKey(id, m.v)))

// True if `model` is a valid preset for the provider (or is the default).
const modelValidFor = (id: ProviderId, model: string | undefined, lists: ModelLists = {}, disabled?: ReadonlySet<string>): boolean =>
  !model || presetsFor(id, lists, disabled).some((m) => m.v === model)

// The model to actually use for a provider given the currently active model:
// keep it if compatible, otherwise fall back to that provider's default (Decision 2).
export const modelForProvider = (id: ProviderId, model: string | undefined, lists: ModelLists = {}, disabled?: ReadonlySet<string>): string =>
  modelValidFor(id, model, lists, disabled) ? (model ?? '') : ''

// Model for a Collab Maker run (D-064). A task may run on a different agent than the
// run default. The run's model (e.g. "opus") belongs to the run's provider only; a
// task on another provider with no model of its own gets THAT provider's default,
// never the run model. Any model that doesn't fit the provider is dropped.
export function resolveTaskModel(
  runProvider: ProviderId, runModel: string | undefined,
  taskProvider: ProviderId | null | undefined, taskModel: string | null | undefined,
  lists: ModelLists = {}, disabled?: ReadonlySet<string>
): string {
  const provider = taskProvider ?? runProvider
  const wanted = taskModel ?? (provider === runProvider ? runModel : undefined)
  return modelForProvider(provider, wanted || undefined, lists, disabled)
}
