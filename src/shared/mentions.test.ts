import { describe, it, expect } from 'vitest'
import { parseAgentMentions } from './mentions'

describe('parseAgentMentions', () => {
  it('@debate / @critique / @research pick a thinking mode (D-083)', () => {
    expect(parseAgentMentions('@debate we should ship weekly')).toEqual({ targets: [], cleaned: 'we should ship weekly', thinking: 'debate' })
    expect(parseAgentMentions('Please @critique this plan').thinking).toBe('critique')
    expect(parseAgentMentions('@Research the Figma Config news').thinking).toBe('research')
    expect(parseAgentMentions('a @debatable point').thinking).toBeUndefined()
  })
  it('returns no targets and the original text when there is no mention', () => {
    expect(parseAgentMentions('plain question')).toEqual({ targets: [], cleaned: 'plain question' })
  })
  it('parses one leading mention and strips it from the prompt', () => {
    expect(parseAgentMentions('@codex review this')).toEqual({ targets: ['codex'], cleaned: 'review this' })
  })
  it('parses a chain, in order, deduplicated', () => {
    const r = parseAgentMentions('@claude @codex @claude go')
    expect(r.targets).toEqual(['claude-code', 'codex'])
    expect(r.cleaned).toBe('go')
  })
  it('is case-insensitive on the handle', () => {
    expect(parseAgentMentions('@Claude hi').targets).toEqual(['claude-code'])
  })
  it('stops at the first unknown handle and treats the rest as text', () => {
    expect(parseAgentMentions('@codex @bob hi')).toEqual({ targets: ['codex'], cleaned: '@bob hi' })
  })
  it('an unknown first token is not a mention at all', () => {
    expect(parseAgentMentions('@bob hi')).toEqual({ targets: [], cleaned: '@bob hi' })
  })
  it('@all fans out to every agent in parallel', () => {
    const r = parseAgentMentions('@all what do you think?')
    expect(r.parallel).toBe(true)
    expect(r.targets).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    expect(r.cleaned).toBe('what do you think?')
  })
  it('a mention in the middle of the text is not a routing target', () => {
    expect(parseAgentMentions('ask @codex later').targets).toEqual([])
  })
  it('@all anywhere in the message fans out too, and stays in the text', () => {
    const r = parseAgentMentions('Hello @all, how are you guys')
    expect(r.parallel).toBe(true)
    expect(r.targets).toEqual(['claude-code', 'codex', 'grok', 'gemini'])
    expect(r.cleaned).toBe('Hello @all, how are you guys')
    expect(parseAgentMentions('thanks @ALL!').parallel).toBe(true)
  })
  it('does not treat @all inside a word or address as a mention', () => {
    expect(parseAgentMentions('mail me at team@all.com').targets).toEqual([])
    expect(parseAgentMentions('is this @allowed?').targets).toEqual([])
    expect(parseAgentMentions('see @all-hands notes').targets).toEqual([])
  })
})
