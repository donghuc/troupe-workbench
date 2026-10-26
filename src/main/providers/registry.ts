import type { ProviderId } from '../../shared/types'
import type { ProviderDescriptor, ProviderAvailability } from '../../shared/agent'
import type { AgentProvider } from './AgentProvider'
import { ClaudeCodeProvider } from './ClaudeCodeProvider'
import { CodexProvider } from './CodexProvider'
import { GrokProvider } from './GrokProvider'
import { GeminiProvider } from './GeminiProvider'
import { CustomCliProvider } from './CustomCliProvider'
import { isCustomAgentId } from '../../shared/providers'
import { getCustomAgent, listCustomAgents } from '../agents/customAgentStore'

type ProviderFactory = () => AgentProvider

const factories = new Map<ProviderId, ProviderFactory>()

function registerProvider(id: ProviderId, factory: ProviderFactory): void {
  factories.set(id, factory)
}

// Fresh instance per run → isolated cancel state, safe for parallel conversations (D-004).
// User-added agents (2.4) are built from their saved entry; a removed (archived) one can't run.
export function createProvider(id: ProviderId): AgentProvider | undefined {
  if (isCustomAgentId(id)) {
    const a = getCustomAgent(id)
    return a && !a.archived ? new CustomCliProvider(a) : undefined
  }
  return factories.get(id)?.()
}

// Every id in shared/providers.ts BUILTIN_PROVIDERS must be registered here (D-070).
export function registerDefaultProviders(): void {
  registerProvider('claude-code', () => new ClaudeCodeProvider())
  registerProvider('codex', () => new CodexProvider())
  registerProvider('grok', () => new GrokProvider())
  registerProvider('gemini', () => new GeminiProvider())
}

const PROBE_TIMEOUT_MS = 10_000
function withDeadline(p: Promise<ProviderAvailability>, ms: number, name: string): Promise<ProviderAvailability> {
  let t: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<ProviderAvailability>((resolve) => { t = setTimeout(() => resolve({ installed: false, authenticated: false, detail: `${name} didn't answer within ${ms / 1000} s. Re-check, or run it once in Terminal.` }), ms) })
  return Promise.race([p.catch((e) => ({ installed: false, authenticated: false, detail: String(e?.message ?? e) })), late]).finally(() => clearTimeout(t))
}

export async function describeProviders(): Promise<ProviderDescriptor[]> {
  const makers: [ProviderId, ProviderFactory][] = [...factories, ...listCustomAgents().filter((a) => !a.archived).map((a): [ProviderId, ProviderFactory] => [a.id, () => new CustomCliProvider(a)])]
  // Audit #5: check every agent at once, each with a deadline, so one slow CLI doesn't hold the rest.
  return Promise.all(makers.map(async ([id, make]): Promise<ProviderDescriptor> => {
    const p = make()
    return { id, name: p.name, capabilities: p.getCapabilities(), availability: await withDeadline(p.isAvailable(), PROBE_TIMEOUT_MS, p.name) }
  }))
}
