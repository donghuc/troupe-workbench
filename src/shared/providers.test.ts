import { describe, it, expect } from 'vitest'
import { BUILTIN_PROVIDERS, BUILTIN_IDS, setCustomAgents, agentIds, agentEntry, isCustomAgentId, isProviderId, providerLabel, parseDisabledAgents, enabledProviderIds, serializeDisabledAgents, offMessage, firstRunAgentsOff } from './providers'
import { agentHandles } from './mentions'

describe('provider catalog', () => {
  it('has one consistent entry per agent', () => {
    expect(BUILTIN_IDS).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    for (const id of BUILTIN_IDS) expect(BUILTIN_PROVIDERS[id].id).toBe(id)
    expect(new Set(BUILTIN_IDS.map((id) => BUILTIN_PROVIDERS[id].handle)).size).toBe(BUILTIN_IDS.length)
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
    expect(agentHandles().map((a) => a.handle)).toEqual(['claude', 'codex', 'grok', 'gemini'])
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


describe('user-added agents (2.4)', () => {
  const entry = (id: `x-${string}`, label: string, archived = false) => ({ id, label, handle: label.toLowerCase(), cli: label.toLowerCase(), strongModel: '', memoryFile: null, globalMemoryPath: null, builtinTools: [], archived })
  it('joins the agent list after the built-ins, archived ones left out but still labelled', () => {
    setCustomAgents([entry('x-opencode', 'OpenCode'), entry('x-old', 'Old', true)])
    try {
      expect(agentIds()).toEqual(['claude-code', 'codex', 'grok', 'gemini', 'x-opencode'])
      expect(isProviderId('x-opencode')).toBe(true)
      expect(isProviderId('x-old')).toBe(true)
      expect(providerLabel('x-old')).toBe('Old')
      expect(agentHandles().map((a) => a.handle)).toContain('opencode')
      expect(enabledProviderIds('x-opencode')).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    } finally { setCustomAgents([]) }
  })
  it('keeps custom ids in the off-list even before they are loaded', () => {
    expect(isCustomAgentId('x-cursor')).toBe(true)
    expect(isCustomAgentId('x-')).toBe(false)
    expect(isCustomAgentId('opencode')).toBe(false)
    expect(parseDisabledAgents('grok,x-cursor')).toEqual(['grok', 'x-cursor'])
    expect(serializeDisabledAgents(['x-cursor', 'grok'])).toBe('grok,x-cursor')
    expect(isProviderId('x-cursor')).toBe(false)
    expect(agentEntry('x-cursor').label).toBe('cursor')
  })
  it('never lets a custom entry shadow a built-in', () => {
    setCustomAgents([entry('codex' as `x-${string}`, 'Fake')])
    try { expect(agentIds()).toEqual(BUILTIN_IDS) } finally { setCustomAgents([]) }
  })
})
