import { describe, it, expect } from 'vitest'
import { claudeEvents, newClaudeState } from './claudeEvents'

describe('claudeEvents result errors', () => {
  it('shows the listed reason when a run fails before any text (sandbox unavailable)', () => {
    const ev = claudeEvents({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Sandbox required but unavailable: bubblewrap not installed'] }, newClaudeState())
    expect(ev).toContainEqual({ type: 'error', message: 'Sandbox required but unavailable: bubblewrap not installed', fatal: true })
  })
  it('falls back to the subtype', () => {
    const ev = claudeEvents({ type: 'result', subtype: 'error_max_turns', is_error: true }, newClaudeState())
    expect(ev.find((e) => e.type === 'error')).toMatchObject({ message: 'error_max_turns' })
  })
})

describe('claudeEvents several result frames (B-077)', () => {
  const texts = (frames: object[]) => { const st = newClaudeState(); return frames.flatMap(f => claudeEvents(f, st)).filter(e => e.type === 'text_delta').map(e => (e as { text: string }).text).join('') }
  const said = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
  const result = { type: 'result', subtype: 'success', usage: {} }
  it('sends the answer once when later result frames bring no new text', () => {
    expect(texts([said('Answer'), result, result, result])).toBe('Answer')
  })
  it('adds text written after an earlier result, on its own paragraph', () => {
    expect(texts([said('First'), result, said('Second'), result])).toBe('First\n\nSecond')
  })
})
