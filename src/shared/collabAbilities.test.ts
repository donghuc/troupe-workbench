import { describe, expect, it } from 'vitest'
import { abilityIn, needOfText, needOfTool, runBlocker, runLimits, type RunSettings } from './collabAbilities'

const S = (o: Partial<RunSettings> = {}): RunSettings => ({ mode: 'auto', webOn: true, shellOn: true, sandboxOn: true, windows: false, ...o })
const ALL = { fileWrite: true, shell: true, web: true }

describe('what agents can do in this run (D-127)', () => {
  it('cuts each agent by the run mode and the Tools settings', () => {
    expect(abilityIn('claude-code', ALL, S())).toEqual({ read: true, write: true, shell: true, web: true })
    expect(abilityIn('claude-code', ALL, S({ mode: 'read' }))).toEqual({ read: true, write: false, shell: false, web: false })
    expect(abilityIn('grok', ALL, S()).shell).toBe(false)                         // its shell always stops at a prompt
    expect(abilityIn('grok', ALL, S({ mode: 'full' })).shell).toBe(true)
    expect(abilityIn('claude-code', ALL, S({ windows: true })).shell).toBe(false)   // no sandbox on Windows
    expect(abilityIn('codex', ALL, S({ shellOn: false })).shell).toBe(false)
    expect(abilityIn('x-text', { fileWrite: false, shell: false, web: false }, S()).read).toBe(false)
  })
  it('says what nobody in the run can do', () => {
    const read = [abilityIn('claude-code', ALL, S({ mode: 'read' })), abilityIn('codex', ALL, S({ mode: 'read' }))]
    expect(runLimits(S({ mode: 'read' }), read)).toMatch(/Read-only\. No agent in it can change project files .*run commands.*use the web/)
    expect(runLimits(S(), [abilityIn('codex', ALL, S())])).toBe('This run is Auto.')
  })
  it('tells a run limit from an agent limit', () => {
    const here = [abilityIn('claude-code', ALL, S({ mode: 'read' }))]
    const auto = [abilityIn('claude-code', ALL, S())]
    expect(runBlocker('write', here, auto)).toEqual({ mode: true })
    const grokAndCodex = [abilityIn('grok', ALL, S()), abilityIn('codex', ALL, S())]
    expect(runBlocker('shell', grokAndCodex, grokAndCodex)).toBeNull()             // Codex can: Grok's own limit
    expect(runBlocker('shell', [abilityIn('grok', ALL, S())], [abilityIn('grok', ALL, S())])).toEqual({ mode: false })
  })
  it('reads what a blocked tool or a "blocked" reason needed', () => {
    expect(needOfTool('run_terminal_command')).toBe('shell')
    expect(needOfTool('Bash')).toBe('shell')
    expect(needOfTool('write')).toBe('write')
    expect(needOfTool('search_replace')).toBe('write')
    expect(needOfTool('web_fetch')).toBe('web')
    expect(needOfText('The run is read-only; it needs Auto mode to write the file.')).toBe('write')
    expect(needOfText('Permission denied running the tests')).toBe('shell')
    expect(needOfText("Can't find README.md in the project")).toBeNull()             // not about permissions
  })
})
