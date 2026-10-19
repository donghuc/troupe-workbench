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
