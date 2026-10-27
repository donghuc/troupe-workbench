import { describe, it, expect, vi } from 'vitest'

// Audit #16: the one context assembly, in the order the five agents used.
vi.mock('../context/projectMemory', () => ({ memoryDelivery: () => 'injected', globalMemoryDelivery: () => 'injected' }))
const { buildContextBlock, withPreamble } = await import('./contextBlock')

const req = (extra = {}) => ({
  prompt: 'hi', cwd: '', context: { instructions: 'I', globalMemory: 'G', memory: 'M', persistentContext: 'P', skillText: 'S', snapshot: 'H', attachmentsText: 'A', ...extra }
}) as never

describe('buildContextBlock', () => {
  it('keeps the order: lead, instructions, global memory, memory, context, rules, skills, summary, attachments, tail', () => {
    expect(buildContextBlock('codex', req(), { lead: 'L', rules: 'R', tail: 'T' }).split('\n\n')).toEqual(['L', 'I', 'G', 'M', 'P', 'R', 'S', 'H', 'A', 'T'])
  })
  it('leaves out the turn context for Claude, and the rules when asked', () => {
    expect(buildContextBlock('claude-code', req(), { rules: '', withTurnContext: false }).split('\n\n')).toEqual(['I', 'G', 'M', 'P'])
  })
  it('wraps a non-empty block in the preamble only', () => {
    expect(withPreamble('', 'hi')).toBe('hi')
    expect(withPreamble('X', 'hi')).toBe('<workbench_context>\nX\n</workbench_context>\n\nhi')
  })
})
