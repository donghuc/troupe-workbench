import { describe, it, expect } from 'vitest'
import { planTurn } from './turnPlan'

describe('planTurn', () => {
  it('routes a plain message to the default provider, sequentially', () => {
    expect(planTurn('hello', 'codex')).toEqual({ mode: 'sequential', chain: ['codex'], prompt: 'hello' })
  })
  it('a mention overrides the default and is stripped from the prompt', () => {
    expect(planTurn('@claude fix it', 'codex')).toEqual({ mode: 'sequential', chain: ['claude-code'], prompt: 'fix it' })
  })
  it('a chain runs in mention order', () => {
    expect(planTurn('@codex @claude review', 'grok').chain).toEqual(['codex', 'claude-code'])
  })
  it('@all is parallel across every agent', () => {
    const p = planTurn('@all thoughts?', 'codex')
    expect(p.mode).toBe('parallel')
    expect(p.chain).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    expect(p.prompt).toBe('thoughts?')
  })
  it('a mention with nothing after it keeps the original text as the prompt', () => {
    expect(planTurn('@codex', 'claude-code').prompt).toBe('@codex')
  })
  it('@all fans out to the agents that are on', () => {
    const p = planTurn('@all thoughts?', 'codex', ['claude-code', 'codex'])
    expect(p.chain).toEqual(['claude-code', 'codex'])
    expect(p.blocked).toBeUndefined()
  })
  it('naming or defaulting to an agent that is off blocks the turn (D-071)', () => {
    expect(planTurn('@grok hi', 'claude-code', ['claude-code', 'codex']).blocked).toEqual(['grok'])
    expect(planTurn('hi', 'grok', ['claude-code']).blocked).toEqual(['grok'])
    expect(planTurn('@claude @grok hi', 'codex', ['claude-code', 'codex']).blocked).toEqual(['grok'])
    expect(planTurn('hi', 'codex', ['claude-code', 'codex']).blocked).toBeUndefined()
  })
})
