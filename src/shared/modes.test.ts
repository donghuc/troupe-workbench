import { describe, it, expect } from 'vitest'
import { parseModeTemplates, buildModeSteps, castFor, describeCast, DEFAULT_TEMPLATES } from './modes'

describe('thinking modes (D-083)', () => {
  it('parses templates over the defaults and clamps rounds', () => {
    const t = parseModeTemplates('{"debate":{"roles":{"for":"gemini","judge":"nope"},"rounds":9},"research":{"roles":{"gather":"codex"}}}')
    expect(t.debate.roles).toEqual({ for: 'gemini', against: 'codex', judge: 'gemini' })
    expect(t.debate.rounds).toBe(3)
    expect(t.research.roles.gather).toBe('codex')
    expect(parseModeTemplates('junk')).toEqual(DEFAULT_TEMPLATES)
  })
  it('builds a debate as for/against per round then a judge, and never blocks on an agent that is off', () => {
    const steps = buildModeSteps('debate', { roles: { for: 'claude-code', against: 'codex', judge: 'gemini' }, rounds: 2 }, 'gemini')
    expect(steps.map((s) => s.role)).toEqual(['for', 'against', 'for', 'against', 'judge'])
    expect(steps[4].provider).toBe('claude-code')   // Gemini off → first agent on
    expect(steps[4].fallback).toBe(true)
    expect(steps[0].instruction).toContain('round 1 of 2')
  })
  it('critique is produce → attack → produce; research is gather → check', () => {
    expect(buildModeSteps('critique', DEFAULT_TEMPLATES.critique, null).map((s) => `${s.role}:${s.provider}`)).toEqual(['produce:claude-code', 'attack:codex', 'produce:claude-code'])
    expect(buildModeSteps('research', DEFAULT_TEMPLATES.research, null).map((s) => s.provider)).toEqual(['gemini', 'claude-code'])
  })
  it('the same agent may play every role', () => {
    const { cast, fallbacks } = castFor('debate', DEFAULT_TEMPLATES.debate, 'codex,gemini,grok')
    expect(Object.values(cast)).toEqual(['claude-code', 'claude-code', 'claude-code'])
    expect(fallbacks).toEqual(['against', 'judge'])
    expect(describeCast('debate', DEFAULT_TEMPLATES.debate, null)).toBe('Debate · For: Claude · Against: Codex · Judge: Gemini · 2 rounds')
  })
})
