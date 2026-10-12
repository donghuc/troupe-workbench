import { describe, it, expect } from 'vitest'
import { PROVIDERS, PROVIDER_IDS, isProviderId, providerLabel, parseDisabledAgents, enabledProviderIds, serializeDisabledAgents, offMessage, firstRunAgentsOff } from './providers'
import { agentHandles } from './mentions'

describe('provider catalog', () => {
  it('has one consistent entry per agent', () => {
    expect(PROVIDER_IDS).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id)
    expect(new Set(PROVIDER_IDS.map((id) => PROVIDERS[id].handle)).size).toBe(PROVIDER_IDS.length)
  })
  it('labels agents, including Grok, with a fallback for unknown ids', () => {
    expect(providerLabel('grok')).toBe('Grok')
    expect(providerLabel('codex')).toBe('Codex')
    expect(providerLabel(null)).toBe('Assistant')
    expect(providerLabel('mock', 'Claude')).toBe('Claude')
  })
  it('validates ids', () => {
    expect(isProviderId('claude-code')).toBe(true)
    expect(isProviderId('gpt')).toBe(false)
    expect(isProviderId(undefined)).toBe(false)
  })
  it('drives @mention handles', () => {
    expect(agentHandles.map((a) => a.handle)).toEqual(['claude', 'codex', 'grok', 'gemini'])
  })
})

describe('turning agents on/off (D-071)', () => {
  it('parses the setting, ignoring unknown ids', () => {
    expect(parseDisabledAgents('grok, codex,mock')).toEqual(['grok', 'codex'])
    expect(parseDisabledAgents(null)).toEqual([])
  })
  it('lists the agents that are on, never none', () => {
    expect(enabledProviderIds('grok')).toEqual(['claude-code', 'codex', 'gemini'])
    expect(enabledProviderIds('')).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    expect(enabledProviderIds('claude-code,codex,grok,gemini')).toEqual(['claude-code'])
  })
  it('serialises in catalog order and words refusals', () => {
    expect(serializeDisabledAgents(['grok', 'codex'])).toBe('codex,grok')
    expect(offMessage(['grok'])).toBe('Grok is turned off in Settings ▸ Agents.')
    expect(offMessage(['codex', 'grok'])).toBe('Codex and Grok are turned off in Settings ▸ Agents.')
  })
})

describe('first launch (D-074)', () => {
  const st = (c: boolean, x: boolean, g: boolean) => ({ 'claude-code': { installed: c }, codex: { installed: x }, grok: { installed: g }, gemini: { installed: g } })
  it('switches off agents whose CLI is missing', () => {
    expect(firstRunAgentsOff(st(true, false, false))).toEqual(['codex', 'grok', 'gemini'])
    expect(firstRunAgentsOff(st(true, true, true))).toEqual([])
  })
  it('never switches everything off, and does nothing if a status is unknown', () => {
    expect(firstRunAgentsOff(st(false, false, false))).toEqual([])
    expect(firstRunAgentsOff({ 'claude-code': { installed: true } })).toEqual([])
  })
})

