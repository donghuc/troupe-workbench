import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const { grokStopNote, grokModeRule, grokPermFlags, grokPermFlagsLegacy, grokToolsListRejected, grokRejectedFlag, grokBlockedTool, withGrokDependants, learnGrokRequirements } = await import('./GrokProvider')
const { PERMISSION_BLOCKED_RE } = await import('../../shared/collabRecovery')

describe('Grok stop reasons and the Auto rule (D-121)', () => {
  it('says nothing for a normal finish', () => {
    for (const r of [undefined, 'end_turn', 'EndTurn', 'stop', 'completed']) expect(grokStopNote(r, 'auto')).toBe('')
  })
  it('explains a refused tool call, and other early stops', () => {
    expect(grokStopNote('permission_cancelled', 'auto')).toMatch(/needed approval, which Troupe can't give in Auto \(a shell command/)
    expect(grokStopNote('max_turns', 'auto')).toMatch(/ran out of steps/)
    expect(grokStopNote('weird', 'full')).toBe('_Grok stopped (`weird`)._')
  })
  it('tells Grok in Auto to use file tools, not the shell', () => {
    expect(grokModeRule('auto')).toMatch(/There is no shell in this mode/)
    expect(grokModeRule('full')).toBe('')
    expect(grokModeRule('auto', 'image')).toBe('')
  })

  it('names the tool a cancelled turn was blocked on, in words the orchestrator recognises', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-')); const cwd = '/Users/x/My Projects/App'
    const dir = join(home, '.grok', 'sessions', encodeURIComponent(cwd), 's1'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'events.jsonl'), [
      { type: 'permission_resolved', tool_name: 'read_file', decision: 'allow' },
      { type: 'permission_resolved', tool_name: 'web_fetch', decision: 'cancelled', wait_ms: 0 },
      { type: 'turn_ended', outcome: 'cancelled', cancellation_category: 'permission_cancelled' }
    ].map((e) => JSON.stringify(e)).join('\n'))
    expect(await grokBlockedTool(cwd, 's1', home)).toBe('web_fetch')
    expect(await grokBlockedTool(cwd, 'missing', home)).toBeNull()
    const note = grokStopNote('cancelled', 'auto', 'web_fetch')
    expect(PERMISSION_BLOCKED_RE.exec(note)?.[1]).toBe('web_fetch')
  })
  it('names the tools Grok may have in Read-only and Auto — no shell, which --disallowed-tools never removed (D-127)', () => {
    const auto = grokPermFlags('auto', { web: true }).join(' ')
    expect(auto).toBe('--permission-mode acceptEdits --allow Edit --allow MCPTool --allow WebFetch --allow WebSearch --tools read_file,list_dir,grep,todo_write,write,search_replace,search_tool,use_tool,image_gen,image_edit,image_to_video,reference_to_video,web_fetch')
    const read = grokPermFlags('read', { web: true }).join(' ')
    expect(read).toBe('--permission-mode plan --tools read_file,list_dir,grep,todo_write')
    expect(grokPermFlags('read', { web: true, allowWeb: true }).at(-1)).toContain('web_fetch')
    for (const m of ['auto', 'read']) expect(grokPermFlags(m, { web: true }).join(' ')).not.toContain('run_terminal_command')
    expect(grokToolsListRejected('all good')).toBe(false)
  })
  it('pre-approves what each mode needs and removes what would still ask (D-121, the fallback)', () => {
    const auto = grokPermFlagsLegacy('auto', { web: true })
    expect(auto.join(' ')).toBe('--permission-mode acceptEdits --allow Edit --allow MCPTool --allow WebFetch --allow WebSearch --disallowed-tools ask_user_question,enter_plan_mode,scheduler_create,scheduler_delete,run_terminal_command,exit_plan_mode,scheduler_list')
    expect(grokPermFlagsLegacy('auto', { web: false }).at(-1)).toContain('web_fetch,web_search')
    const read = grokPermFlagsLegacy('read', { web: true, allowWeb: true })
    expect(read.slice(0, 6)).toEqual(['--permission-mode', 'plan', '--allow', 'WebFetch', '--allow', 'WebSearch'])
    expect(read.at(-1)).toContain('write,search_replace')
    expect(grokPermFlagsLegacy('read', { web: true }).at(-1)).toContain('web_fetch')
    expect(grokPermFlags('full', { web: true }).slice(0, 2)).toEqual(['--permission-mode', 'bypassPermissions'])
  })

  it('never removes a tool without the tools that require it, and learns new pairs from the error grok gives (test 6)', () => {
    expect(withGrokDependants(['enter_plan_mode', 'scheduler_create'])).toEqual(expect.arrayContaining(['exit_plan_mode', 'scheduler_list', 'scheduler_delete']))
    const err = `Couldn't create session: session initialization failed: tool error: Requirements unsatisfied:
- tool "GrokBuild:scheduler_list": unsatisfied requirements (category "requirements")
- tool "GrokBuild:exit_plan_mode": "exit_plan_mode requires GrokBuild:enter_plan_mode so plan mode can be entered before exiting", expected "include GrokBuild:enter_plan_mode"
- tool "GrokBuild:monitor": unsatisfied requirements (category "requirements")`
    expect(learnGrokRequirements('some other error')).toEqual([])
    expect(learnGrokRequirements(err)).toEqual(['scheduler_list', 'exit_plan_mode', 'monitor'])
    expect(learnGrokRequirements(err)).toEqual([])                       // already known: no second retry
    expect(grokPermFlagsLegacy('auto', { web: true }).at(-1)).toContain('monitor')
  })
  it('MCP off for Grok as a whole; unknown newer options are remembered once (D-133)', () => {
    const auto = grokPermFlags('auto', { web: true, mcpOff: true })
    expect(auto.join(' ')).not.toContain('MCPTool --allow')
    expect(auto[auto.indexOf('--tools') + 1]).not.toContain('use_tool')
    expect(auto.slice(-2)).toEqual(['--deny', 'MCPTool'])
    expect(grokPermFlags('auto', { web: true })[grokPermFlags('auto', { web: true }).indexOf('--tools') + 1]).toContain('use_tool')
    const full = grokPermFlagsLegacy('full', { web: true, mcpOff: true })
    expect(full.join(' ')).toContain('search_tool,use_tool')
    expect(full.slice(-2)).toEqual(['--deny', 'MCPTool'])
    expect(grokRejectedFlag("error: unexpected argument '--disable-web-search' found")).toBe('--disable-web-search')
    expect(grokRejectedFlag("error: unexpected argument '--disable-web-search' found")).toBeNull()   // once
    expect(grokRejectedFlag("error: unexpected argument '--frobnicate' found")).toBeNull()           // not ours
  })
})
