import { describe, it, expect } from 'vitest'
import { shouldShowWelcome, agentState, readyAgents, welcomeAgentsOff, isBroadFolder, nameFromFolder, welcomePrompt, AGENT_SETUP } from './welcome'
import { PROVIDER_IDS } from './providers'

const ok = { installed: true, authenticated: true }
const out = { installed: true, authenticated: false }
const none = { installed: false, authenticated: false }

describe('first-run welcome (D-103)', () => {
  it('shows only to new users', () => {
    expect(shouldShowWelcome(null, 0)).toBe(true)
    expect(shouldShowWelcome('1', 0)).toBe(false)
    expect(shouldShowWelcome(null, 3)).toBe(false)
  })
  it('maps CLI status to a state', () => {
    expect(agentState(undefined)).toBe('checking')
    expect(agentState(none)).toBe('missing')
    expect(agentState(out)).toBe('signin')
    expect(agentState(ok)).toBe('ready')
  })
  it('lists ready agents in display order', () => {
    expect(readyAgents({ gemini: ok, 'claude-code': ok, codex: out, grok: none })).toEqual(['claude-code', 'gemini'])
  })
  it('switches off every agent that is not ready, but never all and not while checking', () => {
    expect(welcomeAgentsOff({ 'claude-code': ok, codex: out, grok: none, gemini: none })).toEqual(['codex', 'grok', 'gemini'])
    expect(welcomeAgentsOff({ 'claude-code': out, codex: none, grok: none, gemini: none })).toEqual([])
    expect(welcomeAgentsOff({ 'claude-code': ok })).toEqual([])
  })
  it('warns about broad folders only', () => {
    for (const p of ['/Users/me', '/Users/me/', '/Users/me/Desktop', '/Users/me/Documents', '/Users/me/Downloads']) expect(isBroadFolder(p)).toBe(true)
    for (const p of ['/Users/me/Documents/Atlas', '/Users/me/Projects', '/Volumes/Work']) expect(isBroadFolder(p)).toBe(false)
  })
  it('names a project after its folder', () => {
    expect(nameFromFolder('/Users/me/Documents/Atlas/')).toBe('Atlas')
  })
  it('uses @all with two or more ready agents, a plain prompt with one', () => {
    expect(welcomePrompt(['claude-code', 'codex'], true)).toMatchObject({ provider: 'claude-code', compare: true })
    expect(welcomePrompt(['claude-code', 'codex'], true)!.text.startsWith('@all ')).toBe(true)
    const one = welcomePrompt(['codex'], false)!
    expect(one).toMatchObject({ provider: 'codex', compare: false })
    expect(one.text).not.toContain('@all')
    expect(welcomePrompt([], true)).toBeNull()
  })
  it('has setup instructions for every agent', () => {
    for (const id of PROVIDER_IDS) expect(AGENT_SETUP[id].signIn).toBeTruthy()
  })
})
