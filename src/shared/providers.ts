// The single list of agents Troupe can run (audit #15, D-070). Everything that needs an
// agent's label, @handle, CLI binary, memory file or built-in tools reads it from here.
// Adding an agent = add it to ProviderId (types.ts), add an entry here (TypeScript
// refuses to build until you do), write its provider class and register it
// (providers/registry.ts), and add its logo/colour (renderer providerMeta.ts).
import type { ProviderId } from './types'

export interface ProviderCatalogEntry {
  id: ProviderId
  label: string                 // shown in the UI, transcripts and exports
  handle: string                // @mention
  cli: string                   // binary name on PATH
  strongModel: string           // model for Collab Planner/Reviewer ('' = the CLI's default)
  memoryFile: 'CLAUDE.md' | 'AGENTS.md' | null   // native project memory file, if the CLI loads one (D-055)
  globalMemoryPath: string | null                // native global memory, for display
  builtinTools: string[]        // shown in the Tools panel
}

export const PROVIDERS: Record<ProviderId, ProviderCatalogEntry> = {
  'claude-code': {
    id: 'claude-code', label: 'Claude', handle: 'claude', cli: 'claude', strongModel: 'opus',
    memoryFile: 'CLAUDE.md', globalMemoryPath: '~/.claude/CLAUDE.md',
    builtinTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookEdit']
  },
  codex: {
    id: 'codex', label: 'Codex', handle: 'codex', cli: 'codex', strongModel: '',
    memoryFile: 'AGENTS.md', globalMemoryPath: '~/.codex/AGENTS.md',
    builtinTools: ['Shell', 'Apply patch', 'File read/write']
  },
  grok: {
    id: 'grok', label: 'Grok', handle: 'grok', cli: 'grok', strongModel: '',
    memoryFile: null, globalMemoryPath: null,
    builtinTools: ['Shell', 'File read/write', 'Web']
  },
  // Google's Antigravity CLI (`agy`), which replaced the Gemini CLI in June 2026 (D-079).
  gemini: {
    id: 'gemini', label: 'Gemini', handle: 'gemini', cli: 'agy', strongModel: '',
    memoryFile: null, globalMemoryPath: null,
    builtinTools: ['File read/write', 'Shell', 'Web search', 'Browser']
  }
}

/** Agents in display order. */
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && v in PROVIDERS

/** Label for an agent id; `fallback` for null/unknown (e.g. an assistant message with no provider). */
export const providerLabel = (id: string | null | undefined, fallback = 'Assistant'): string =>
  (isProviderId(id) ? PROVIDERS[id].label : fallback)

// ── Turning agents on/off (D-071) ────────────────────────────────────────────
/** Setting key: comma-separated ids of agents switched off in Settings ▸ Agents. */
// Settings ▸ Tools: run Claude with `--chrome` (Claude in Chrome extension). Off by default.
export const CHROME_ACCESS_SETTING = 'agent_chrome_access'

export const DISABLED_AGENTS_SETTING = 'disabled_agents'

export function parseDisabledAgents(raw: string | null | undefined): ProviderId[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(isProviderId)
}

/** Agents that are on, in display order. Never empty: if everything is off, Claude stays on. */
export function enabledProviderIds(raw: string | null | undefined): ProviderId[] {
  const off = new Set(parseDisabledAgents(raw))
  const on = PROVIDER_IDS.filter((id) => !off.has(id))
  return on.length ? on : ['claude-code']
}

export const serializeDisabledAgents = (ids: ProviderId[]): string => PROVIDER_IDS.filter((id) => ids.includes(id)).join(',')

/** "Grok is" / "Codex and Grok are" turned off — for refusal messages. */
export function offMessage(ids: ProviderId[]): string {
  const names = ids.map((id) => PROVIDERS[id].label)
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
  if (PROVIDER_IDS.some((id) => !status[id])) return []
  const missing = PROVIDER_IDS.filter((id) => !status[id]!.installed)
  return missing.length < PROVIDER_IDS.length ? missing : []
}
