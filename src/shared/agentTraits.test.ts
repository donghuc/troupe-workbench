import { describe, it, expect } from 'vitest'
import { agentTraits, BUILTIN_IDS } from './providers'
import { IMAGE_AGENTS, isVectorAgent, isSelfSavingAgent } from './imageCanvas'
import { abilityIn } from './collabAbilities'

// Audit #16 (2026-10-27): what sets each agent apart comes from the catalog, not from `id === …`.
describe('agent traits', () => {
  it('keep the behaviour the name checks had', () => {
    expect(IMAGE_AGENTS).toEqual(['codex', 'grok', 'gemini', 'claude-code'])
    expect(isVectorAgent('claude-code')).toBe(true)
    expect(isSelfSavingAgent('grok')).toBe(true)
    expect(agentTraits('codex')).toMatchObject({ mcpConfig: 'codex', mcpNeedsFull: true, readsFilesByShell: true, imageModelSetting: true, modelsFromCli: true })
    expect(agentTraits('claude-code')).toMatchObject({ mcpConfig: 'claude', chrome: true, fastModel: 'haiku', autoShellSandbox: true })
    expect(agentTraits('grok')).toMatchObject({ mcpConfig: 'grok', shellOnlyInFull: true, signInOnFirstUse: true })
    expect(agentTraits('gemini')).toMatchObject({ mcpConfig: null, signInOnFirstUse: true, modelsFromCli: true })
  })
  it('gives unknown and user-added agents the plain defaults', () => {
    expect(agentTraits('x-someone')).toMatchObject({ mcpConfig: null, chrome: false, image: null, fastModel: '' })
    expect(agentTraits(null).image).toBeNull()
    for (const id of BUILTIN_IDS) expect(typeof agentTraits(id).image === 'string' || agentTraits(id).image === null).toBe(true)
  })
  it('Grok has no shell outside Full access; Claude none in Auto on Windows with the sandbox on', () => {
    const caps = { fileWrite: true, shell: true, web: true }
    const s = { mode: 'auto' as const, shellOn: true, webOn: true, windows: false, sandboxOn: true }
    expect(abilityIn('grok', caps, s).shell).toBe(false)
    expect(abilityIn('grok', caps, { ...s, mode: 'full' }).shell).toBe(true)
    expect(abilityIn('claude-code', caps, s).shell).toBe(true)
    expect(abilityIn('claude-code', caps, { ...s, windows: true }).shell).toBe(false)
    expect(abilityIn('codex', caps, { ...s, windows: true }).shell).toBe(true)
  })
})
