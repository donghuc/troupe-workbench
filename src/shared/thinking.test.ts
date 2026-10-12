import { describe, it, expect } from 'vitest'
import { resolveThinkingAgent, buildComparePrompt } from './thinking'

describe('thinking settings (D-081)', () => {
  it('uses the configured agent when it is on, else the chat agent, else the first agent on', () => {
    expect(resolveThinkingAgent(null, null)).toBe('claude-code')
    expect(resolveThinkingAgent('codex', null)).toBe('codex')
    expect(resolveThinkingAgent('claude-code', 'claude-code', 'gemini')).toBe('gemini')
    expect(resolveThinkingAgent('claude-code', 'claude-code,gemini', 'gemini')).toBe('codex')
    expect(resolveThinkingAgent('nope', null)).toBe('claude-code')
  })
  it('builds a compare prompt with labelled replies and the reading-effort rules', () => {
    const p = buildComparePrompt({ question: 'Camp today?', replies: [{ provider: 'claude-code', text: 'Go early.' }, { provider: 'grok', text: '' }] })
    expect(p).toContain('### Reply 1 — Claude')
    expect(p).toContain('### Reply 2 — Grok\n\n(no reply)')
    expect(p).toContain('under 160 words')
    expect(p).toContain('## Question\n\nCamp today?')
  })
})
