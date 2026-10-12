import type { ProviderId } from '../../shared/types'
import type { ProviderDescriptor } from '../../shared/agent'
import type { AgentProvider } from './AgentProvider'
import { ClaudeCodeProvider } from './ClaudeCodeProvider'
import { CodexProvider } from './CodexProvider'
import { GrokProvider } from './GrokProvider'
import { GeminiProvider } from './GeminiProvider'

type ProviderFactory = () => AgentProvider

const factories = new Map<ProviderId, ProviderFactory>()

function registerProvider(id: ProviderId, factory: ProviderFactory): void {
  factories.set(id, factory)
}

// Fresh instance per run → isolated cancel state, safe for parallel conversations (D-004).
export function createProvider(id: ProviderId): AgentProvider | undefined {
  return factories.get(id)?.()
}

// Every id in shared/providers.ts PROVIDERS must be registered here (D-070).
export function registerDefaultProviders(): void {
  registerProvider('claude-code', () => new ClaudeCodeProvider())
  registerProvider('codex', () => new CodexProvider())
  registerProvider('grok', () => new GrokProvider())
  registerProvider('gemini', () => new GeminiProvider())
}

export async function describeProviders(): Promise<ProviderDescriptor[]> {
  const out: ProviderDescriptor[] = []
  for (const [id, make] of factories) {
    const p = make()
    out.push({ id, name: p.name, capabilities: p.getCapabilities(), availability: await p.isAvailable() })
  }
  return out
}
