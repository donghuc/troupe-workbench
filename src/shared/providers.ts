// The agents Troupe can run (audit #15, D-070). Everything that needs an agent's label,
// @handle, CLI binary, memory file or built-in tools asks `agentEntry(id)`.
// Built-in agents: an entry in BUILTIN_PROVIDERS, a provider class (providers/registry.ts)
// and a logo/colour (renderer providerMeta.ts). User-added agents (2.4) are registered at
// runtime with setCustomAgents(); their ids start with "x-". `agentIds()` is the live list
// (built-ins first, then custom agents in the order added; archived ones left out).
import type { ProviderId, BuiltinProviderId, CustomAgentId } from './types'

export interface ProviderCatalogEntry {
  id: ProviderId
  label: string                 // shown in the UI, transcripts and exports
  handle: string                // @mention
  cli: string                   // binary name on PATH
  strongModel: string           // model for Collab Planner/Reviewer ('' = the CLI's default)
  memoryFile: 'CLAUDE.md' | 'AGENTS.md' | null   // native project memory file, if the CLI loads one (D-055)
  globalMemoryPath: string | null                // native global memory, for display
  builtinTools: string[]        // shown in the Tools panel
  traits?: Partial<AgentTraits>  // what sets this agent apart (audit #16); missing = the defaults below
}

/** What sets an agent apart (audit #16, 2026-10-27): asked through `agentTraits(id)` instead of
 *  `if (id === 'grok')` checks spread across the app. Adding an agent = one catalog entry. */
export interface AgentTraits {
  /** Whose MCP configuration it reads (Settings ▸ Tools lists and edits that one); null = none known. */
  mcpConfig: 'claude' | 'codex' | 'grok' | null
  /** Runs MCP tools only in Full access (Codex `exec`). */
  mcpNeedsFull: boolean
  /** Can drive the Claude in Chrome extension (Settings ▸ Tools ▸ Chrome). */
  chrome: boolean
  /** Its shell stops at a prompt outside Full access, so it has no shell in Auto (Grok). */
  shellOnlyInFull: boolean
  /** In Auto its shell runs in its own sandbox — unavailable on Windows (Claude). */
  autoShellSandbox: boolean
  /** Opens files through its shell rather than file tools (Codex), so a read-only review says so. */
  readsFilesByShell: boolean
  /** On the Image canvas: makes raster images, or draws SVG; null = not offered there. */
  image: 'raster' | 'vector' | null
  /** Its image tool saves into its own folder; Troupe collects the files (Grok). */
  imageSelfSaving: boolean
  /** Has its own image-model setting (Settings ▸ Agents), else its config's default (Codex). */
  imageModelSetting: boolean
  /** A cheap model for background work like compacting a chat ('' = the CLI's default). */
  fastModel: string
  /** Its sign-in can only be seen by running it, so "installed" may still be signed out. */
  signInOnFirstUse: boolean
  /** Its model list is read from the CLI's own cache, which may be missing until it has run. */
  modelsFromCli: boolean
}

const TRAIT_DEFAULTS: AgentTraits = {
  mcpConfig: null, mcpNeedsFull: false, chrome: false, shellOnlyInFull: false, autoShellSandbox: false,
  readsFilesByShell: false, image: null, imageSelfSaving: false, imageModelSetting: false, fastModel: '',
  signInOnFirstUse: false, modelsFromCli: false
}

export const BUILTIN_PROVIDERS: Record<BuiltinProviderId, ProviderCatalogEntry> = {
  'claude-code': {
    id: 'claude-code', label: 'Claude', handle: 'claude', cli: 'claude', strongModel: 'opus',
    memoryFile: 'CLAUDE.md', globalMemoryPath: '~/.claude/CLAUDE.md',
    builtinTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookEdit'],
    traits: { mcpConfig: 'claude', chrome: true, autoShellSandbox: true, image: 'vector', fastModel: 'haiku' }
  },
  codex: {
    id: 'codex', label: 'Codex', handle: 'codex', cli: 'codex', strongModel: '',
    memoryFile: 'AGENTS.md', globalMemoryPath: '~/.codex/AGENTS.md',
    builtinTools: ['Shell', 'Apply patch', 'File read/write'],
    traits: { mcpConfig: 'codex', mcpNeedsFull: true, readsFilesByShell: true, image: 'raster', imageModelSetting: true, modelsFromCli: true }
  },
  grok: {
    id: 'grok', label: 'Grok', handle: 'grok', cli: 'grok', strongModel: '',
    memoryFile: null, globalMemoryPath: null,
    builtinTools: ['Shell', 'File read/write', 'Web'],
    traits: { mcpConfig: 'grok', shellOnlyInFull: true, image: 'raster', imageSelfSaving: true, signInOnFirstUse: true }
  },
  // Google's Antigravity CLI (`agy`), which replaced the Gemini CLI in June 2026 (D-079).
  gemini: {
    id: 'gemini', label: 'Gemini', handle: 'gemini', cli: 'agy', strongModel: '',
    memoryFile: null, globalMemoryPath: null,
    builtinTools: ['File read/write', 'Shell', 'Web search', 'Browser'],
    // Its MCP list isn't read yet (D-079).
    traits: { image: 'raster', signInOnFirstUse: true, modelsFromCli: true }
  }
}

/** Built-in agents in display order. */
export const BUILTIN_IDS = Object.keys(BUILTIN_PROVIDERS) as BuiltinProviderId[]

export const isBuiltinId = (v: unknown): v is BuiltinProviderId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(BUILTIN_PROVIDERS, v)
export const isCustomAgentId = (v: unknown): v is CustomAgentId => typeof v === 'string' && /^x-[a-z0-9][a-z0-9-]*$/.test(v)

// ── User-added agents (2.4) ──────────────────────────────────────────────────
export interface CustomCatalogEntry extends ProviderCatalogEntry { id: CustomAgentId; archived?: boolean }
let custom: CustomCatalogEntry[] = []

/** Register the user's custom agents (main and renderer each call this when the list changes). */
export function setCustomAgents(list: CustomCatalogEntry[]): void {
  custom = list.filter((e) => isCustomAgentId(e.id) && !isBuiltinId(e.id))
}

/** Every agent that can be picked: built-ins, then custom agents in the order added (archived left out). */
export function agentIds(): ProviderId[] {
  return [...BUILTIN_IDS, ...custom.filter((e) => !e.archived).map((e) => e.id)]
}

/** A known agent id — built-in, or a registered custom agent (archived ones still count, so old chats resolve). */
export const isProviderId = (v: unknown): v is ProviderId => isBuiltinId(v) || (isCustomAgentId(v) && custom.some((e) => e.id === v))

/** The catalog entry for any agent id. An unknown custom id gets a stand-in, so labels never break. */
export function agentEntry(id: ProviderId): ProviderCatalogEntry {
  if (isBuiltinId(id)) return BUILTIN_PROVIDERS[id]
  const c = custom.find((e) => e.id === id)
  if (c) return c
  const name = String(id).replace(/^x-/, '')
  return { id, label: name, handle: name, cli: '', strongModel: '', memoryFile: null, globalMemoryPath: null, builtinTools: [] }
}

/** What sets this agent apart (audit #16). Unknown and user-added agents get the defaults. */
export function agentTraits(id: string | null | undefined): AgentTraits {
  return { ...TRAIT_DEFAULTS, ...(isProviderId(id) ? agentEntry(id).traits : undefined) }
}

/** Label for an agent id; `fallback` for null/unknown (e.g. an assistant message with no provider). */
export const providerLabel = (id: string | null | undefined, fallback = 'Assistant'): string =>
  (isProviderId(id) ? agentEntry(id).label : fallback)

// ── Turning agents on/off (D-071) ────────────────────────────────────────────
/** Setting key: comma-separated ids of agents switched off in Settings ▸ Agents. */
// Settings ▸ Tools: run Claude with `--chrome` (Claude in Chrome extension). Off by default.
export const CHROME_ACCESS_SETTING = 'agent_chrome_access'

export const DISABLED_AGENTS_SETTING = 'disabled_agents'

export function parseDisabledAgents(raw: string | null | undefined): ProviderId[] {
  // Custom ids are kept even before the custom list is loaded (fix 7): dropping them would turn them back on.
  return (raw ?? '').split(',').map((s) => s.trim()).filter((s): s is ProviderId => isBuiltinId(s) || isCustomAgentId(s))
}

/** Agents that are on, in display order. Never empty: if everything is off, Claude stays on. */
export function enabledProviderIds(raw: string | null | undefined): ProviderId[] {
  const off = new Set(parseDisabledAgents(raw))
  const on = agentIds().filter((id) => !off.has(id))
  return on.length ? on : ['claude-code']
}

// Keeps ids of custom agents that aren't loaded yet, so turning one agent off never forgets another.
export const serializeDisabledAgents = (ids: ProviderId[]): string => [...agentIds().filter((id) => ids.includes(id)), ...ids.filter((id) => !agentIds().includes(id) && isCustomAgentId(id))].join(',')

/** "Grok is" / "Codex and Grok are" turned off — for refusal messages. */
export function offMessage(ids: ProviderId[]): string {
  const names = ids.map((id) => agentEntry(id).label)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `${list} ${names.length > 1 ? 'are' : 'is'} turned off in Settings ▸ Agents.`
}

// ── First launch (D-074) ──────────────────────────────────────────────────────
export const AGENTS_FIRST_RUN_SETTING = 'agents_first_run_done'

/**
 * On a brand-new install, which agents to switch off because their CLI isn't installed.
 * Only when nothing is installed-status-unknown; never switches off every agent (if no CLI
 * is found, all stay on so the "not found" errors point the way).
 */
export function firstRunAgentsOff(status: Partial<Record<ProviderId, { installed: boolean }>>): ProviderId[] {
  if (BUILTIN_IDS.some((id) => !status[id])) return []
  const missing = BUILTIN_IDS.filter((id) => !status[id]!.installed)
  return missing.length < BUILTIN_IDS.length ? missing : []
}
