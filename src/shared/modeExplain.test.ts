import { describe, it, expect } from 'vitest'
import { explainMode } from './modeExplain'

const on = { web: true, shell: true, chrome: false, sandbox: true }
describe('permission mode in plain words (D-151)', () => {
  it('Auto lists what is switched on and what stays blocked', () => {
    expect(explainMode('auto', on)).toEqual({
      can: ['Edit files in this project’s folders', 'Run commands in a sandbox', 'Search and read the web', 'Use the MCP tools that are switched on'],
      cannot: ['Change files outside these folders', 'Run commands outside the sandbox']
    })
    expect(explainMode('auto', { ...on, web: false, shell: false }).cannot).toEqual(['Change files outside these folders', 'Run commands (off in Settings ▸ Tools)', 'Use the web (off in Settings ▸ Tools)'])
  })
  it('Read-only and Full', () => {
    expect(explainMode('read', on).cannot).toContain('Run commands')
    expect(explainMode('full', on).cannot[0]).toMatch(/Nothing is blocked/)
  })
})
