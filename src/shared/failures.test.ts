import { describe, it, expect } from 'vitest'
import { failureKind, describeFailure, resetHint, stoppedTag } from './failures'

describe('failures in plain words (D-151)', () => {
  it('recognises the common agent wordings', () => {
    expect(failureKind('Prompt is too long')).toBe('too-long')
    expect(failureKind('This model\'s maximum context length is 200000 tokens')).toBe('too-long')
    expect(failureKind('Claude AI usage limit reached|1767096000')).toBe('limit')
    expect(failureKind('Error: 429 Too Many Requests')).toBe('limit')
    expect(failureKind('Invalid API key · Please run /login')).toBe('signed-out')
    expect(failureKind('not signed in')).toBe('signed-out')
    expect(failureKind("xyz not found. Check it's installed and the command is right.")).toBe('missing')
    expect(failureKind('Codex was stopped after 15 min without any output.')).toBe('timeout')
    expect(failureKind('getaddrinfo ENOTFOUND api.example.com')).toBe('network')
    expect(failureKind('something odd')).toBe('other')
  })
  it('says when a limit resets', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0)
    expect(resetHint(`usage limit reached|${Math.floor((now + 130 * 60000) / 1000)}`, now)).toMatch(/in 2 h 10 min/)
    expect(resetHint('You have hit your limit. Try again in 3 hours.')).toBe('It is available again in 3 hours.')
    expect(resetHint('quota')).toBeNull()
  })
  it('gives each failure a title, a reason and actions', () => {
    const f = describeFailure('Prompt is too long', 'Codex', 'Claude')
    expect(f).toMatchObject({ kind: 'too-long', title: 'Message too long for Codex', actions: ['compress', 'switch'] })
    expect(describeFailure('not logged in', 'Grok').actions).toEqual(['setup', 'retry'])
    expect(describeFailure('boom', 'Claude').actions).toEqual(['retry'])
  })
  it('tags a reply that ended early', () => {
    expect(stoppedTag({ partial: true, timedOut: true, stopError: 'Codex was stopped after 15 min without any output.' })).toBe('Stopped early · no output for 15 min')
    expect(stoppedTag({ stoppedByUser: true })).toBe('Stopped by you')
    expect(stoppedTag({ partial: true, stopError: 'Prompt is too long' })).toBe('Stopped early · message too long')
    expect(stoppedTag({ usage: {} })).toBeNull()
  })
})
