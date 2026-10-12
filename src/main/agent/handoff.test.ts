import { describe, it, expect } from 'vitest'
import { formatTranscript, buildContextBlock, COMPRESS_TRANSCRIPT } from './handoff'
import type { Message } from '../../shared/types'

const msg = (role: Message['role'], content: string, provider: Message['provider'] = null, i = 0): Message =>
  ({ id: `m${i}`, conversationId: 'c', role, provider, content, createdAt: i, metadata: null })

describe('formatTranscript', () => {
  it('labels turns by author', () => {
    const t = formatTranscript([msg('user', 'hi'), msg('assistant', 'hello', 'codex', 1), msg('assistant', 'hey', 'claude-code', 2), msg('assistant', 'yo', 'grok', 3)])
    expect(t).toBe('User: hi\n\nCodex: hello\n\nClaude: hey\n\nGrok: yo')
  })
  it('keeps only the last maxTurns', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => msg('user', `t${i}`, null, i))
    const t = formatTranscript(msgs, { maxTurns: 5 })
    expect(t.split('\n\n')).toHaveLength(5)
    expect(t.startsWith('User: t25')).toBe(true)
  })
  it('clips older turns hard but keeps the recent ones nearly whole (B-014)', () => {
    const long = 'x'.repeat(5000)
    const msgs = [msg('user', long, null, 0), msg('assistant', long, 'codex', 1), msg('user', long, null, 2)]
    const parts = formatTranscript(msgs).split('\n\n')
    expect(parts[0].length).toBeLessThanOrEqual('User: '.length + 1000 + 1)   // old cap 1000 + ellipsis
    expect(parts[2].length).toBe('User: '.length + 5000)                       // recent cap 8000 → untouched
    expect(parts[0].endsWith('…')).toBe(true)
  })
  it('COMPRESS_TRANSCRIPT gives older turns much more room', () => {
    const long = 'x'.repeat(5000)
    const msgs = [msg('user', long, null, 0), msg('user', 'a', null, 1), msg('user', 'b', null, 2)]
    const parts = formatTranscript(msgs, COMPRESS_TRANSCRIPT).split('\n\n')
    expect(parts[0].length).toBe('User: '.length + 4000 + 1)
  })
})

describe('buildContextBlock', () => {
  it('is empty for no messages', () => {
    expect(buildContextBlock([])).toBe('')
  })
  it('wraps the transcript with the shared-conversation header and the closing instruction', () => {
    const b = buildContextBlock([msg('user', 'hi')])
    expect(b.startsWith('# Shared conversation so far')).toBe(true)
    expect(b).toContain('User: hi')
    expect(b.trimEnd().endsWith('using this shared context.')).toBe(true)
  })
})
