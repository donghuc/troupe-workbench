import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { testDb } from '../testing/memoryDb'
import type { AgentEvent, AgentRequest } from '../../shared/agent'

// D-096: each provider end to end through the shared CLI runner, against a fake CLI on
// PATH that records its argv + stdin and prints frames in that CLI's real format.
const tmp = mkdtempSync(join(tmpdir(), 'wb-prov-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logWarn: () => {}, logError: () => {} }))
vi.mock('../tools/toolsService', () => ({ configuredClaudeMcpNames: () => [], liveClaudeMcpNames: () => [] }))

const bin = join(tmp, 'bin'); const project = join(tmp, 'project'); const rec = join(tmp, 'rec')
const fake = (name: string, frames: unknown[], exit = 0, stderr = '') => {
  const f = join(bin, name)
  writeFileSync(f, `#!/usr/bin/env node
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  require('fs').writeFileSync(${JSON.stringify(join(rec, name))}, JSON.stringify({ argv: process.argv.slice(2), stdin: s }))
  for (const fr of ${JSON.stringify(frames)}) console.log(typeof fr === 'string' ? fr : JSON.stringify(fr))
  ${stderr ? `process.stderr.write(${JSON.stringify(stderr)});` : ''}process.exit(${exit})
})`)
  chmodSync(f, 0o755)
}
const recorded = (name: string): { argv: string[]; stdin: string } => JSON.parse(readFileSync(join(rec, name), 'utf8'))
const req = (over: Partial<AgentRequest> = {}): AgentRequest => ({ prompt: 'What is 2+2?', context: { instructions: 'Be brief.' }, cwd: project, permissionMode: 'auto', ...over } as AgentRequest)
async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out }

let savedPath: string | undefined
beforeAll(() => { mkdirSync(bin); mkdirSync(project); mkdirSync(rec); savedPath = process.env.PATH; process.env.PATH = `${bin}:${savedPath}` })
afterAll(() => { process.env.PATH = savedPath })

// The fake CLIs are `#!/usr/bin/env node` scripts on PATH, which Windows can't run by name
// (no shebangs; it would need .cmd shims) — and Gemini isn't offered on Windows. The Windows
// side of spawning is covered by the platform tests and the CI smoke run instead.
describe.skipIf(process.platform === 'win32')('providers through CliProcess (D-096)', () => {
  it('Claude: prompt on stdin, stream-json mapped, system prompt file passed', async () => {
    fake('claude', [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-x' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Fo' } } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file: 'a' }, id: 't1' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ur' } } },
      'not json',
      { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 2 }, total_cost_usd: 0.01 }
    ])
    const { ClaudeCodeProvider } = await import('./ClaudeCodeProvider')
    const evs = await collect(new ClaudeCodeProvider().run(req()))
    expect(evs.map((e) => e.type)).toEqual(['session_started', 'text_delta', 'tool_start', 'tool_end', 'text_delta', 'complete'])
    expect(evs.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('')).toBe('Four')
    const r = recorded('claude')
    expect(r.stdin).toContain('What is 2+2?')
    expect(r.argv).not.toContain('What is 2+2?')
    expect(r.argv).toContain('--append-system-prompt-file')
  })

  it('Claude: a failed exit becomes one fatal error with stderr', async () => {
    fake('claude', [], 1, 'Error: usage limit reached')
    const { ClaudeCodeProvider } = await import('./ClaudeCodeProvider')
    const evs = await collect(new ClaudeCodeProvider().run(req()))
    expect(evs).toEqual([{ type: 'error', message: 'Error: usage limit reached', fatal: true }])
  })

  it('Codex: exec - with prompt on stdin, items mapped, usage split', async () => {
    fake('codex', [
      { type: 'thread.started', thread_id: 'th1' },
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { id: 'c1', type: 'command_execution', status: 'completed' } },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Four.' } },
      { type: 'item.completed', item: { id: 'm2', type: 'agent_message', text: 'Done.' } },
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 7 } }
    ])
    const { CodexProvider } = await import('./CodexProvider')
    const evs = await collect(new CodexProvider().run(req()))
    expect(evs.map((e) => e.type)).toEqual(['session_started', 'status', 'tool_start', 'tool_end', 'text_delta', 'text_delta', 'complete'])
    expect(evs.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('')).toBe('Four.\n\nDone.')
    expect(evs.at(-1)).toEqual({ type: 'complete', usage: { inputTokens: 40, cacheReadTokens: 60, outputTokens: 7 } })
    const r = recorded('codex')
    expect(r.argv[0]).toBe('exec'); expect(r.argv.at(-1)).toBe('-')
    expect(r.stdin).toContain('What is 2+2?')
  })

  it('Gemini (agy): stdin user event, step updates mapped, complete synthesized on clean exit', async () => {
    fake('agy', [
      { event: 'init', conversation_id: 'g1', init: { cwd: project } },
      { event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Four' } }
    ])
    const { GeminiProvider } = await import('./GeminiProvider')
    const evs = await collect(new GeminiProvider().run(req()))
    expect(evs.map((e) => e.type).filter((t) => t !== 'status')).toEqual(['session_started', 'text_delta', 'complete'])
    const r = recorded('agy')
    expect(JSON.parse(r.stdin.trim())).toMatchObject({ event: 'user' })
    expect(JSON.parse(r.stdin.trim()).message.content).toContain('What is 2+2?')
  })

  it('Gemini (agy): non-zero exit before a result is a fatal error', async () => {
    fake('agy', [], 2, 'some log\nError: not signed in\n')
    const { GeminiProvider } = await import('./GeminiProvider')
    const evs = await collect(new GeminiProvider().run(req()))
    expect(evs).toEqual([{ type: 'error', message: 'not signed in', fatal: true }])
  })

  it('Grok: one JSON result via exec', async () => {
    fake('grok', [{ text: 'Four.', sessionId: 'k1', usage: { input_tokens: 9, output_tokens: 2 } }])
    const { GrokProvider } = await import('./GrokProvider')
    const evs = await collect(new GrokProvider().run(req()))
    expect(evs.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('')).toContain('Four.')
    expect(evs.at(-1)?.type).toBe('complete')
    expect(recorded('grok').argv).toContain('-p')
  })
  it('Grok in Auto pre-approves its file tools; a cancelled turn says so (D-121)', async () => {
    fake('grok', [{ text: 'I will write facts.md now.', stopReason: 'cancelled', sessionId: 'k2' }])
    const { GrokProvider } = await import('./GrokProvider')
    const evs = await collect(new GrokProvider().run(req({ permissionMode: 'auto' })))
    const argv = recorded('grok').argv
    expect(argv.slice(argv.indexOf('--permission-mode'), argv.indexOf('--permission-mode') + 4)).toEqual(['--permission-mode', 'acceptEdits', '--allow', 'Edit'])
    // D-127: the tools Grok may have are named; the shell isn't among them
    expect(argv[argv.indexOf('--tools') + 1]).toContain('write')
    expect(argv[argv.indexOf('--tools') + 1]).not.toContain('run_terminal_command')
    expect(evs.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('')).toMatch(/Grok stopped before finishing \(`cancelled`\)/)
  })
  it('Custom (text): prompt as one argument, context preamble, plain text streamed', async () => {
    fake('mytool', ['Four.'])
    const { CustomCliProvider } = await import('./CustomCliProvider')
    const agent = { id: 'x-mytool' as const, name: 'My Tool', handle: 'mytool', command: 'mytool run {prompt}', bin: 'mytool', args: ['run', '{prompt}'], output: 'text' as const, modelFlag: '--model' }
    const evs = await collect(new CustomCliProvider(agent).run(req({ model: 'm1' })))
    expect(evs.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('')).toBe('Four.\n')
    expect(evs.at(-1)).toEqual({ type: 'complete', usage: {} })
    const r = recorded('mytool')
    expect(r.argv).toHaveLength(4)
    expect(r.argv[0]).toBe('run'); expect(r.argv[1]).toContain('<workbench_context>'); expect(r.argv[1]).toContain('What is 2+2?')
    expect(r.argv.slice(2)).toEqual(['--model', 'm1'])
    expect(r.stdin).toBe('')
  })

  it('Custom (text): stdin when there is no {prompt}; read-only asked for when it can\'t be enforced', async () => {
    fake('mytool', ['ok'])
    const { CustomCliProvider, READ_ONLY_NOTE } = await import('./CustomCliProvider')
    const agent = { id: 'x-mytool' as const, name: 'My Tool', handle: 'mytool', command: 'mytool -p', bin: 'mytool', args: ['-p'], output: 'text' as const }
    await collect(new CustomCliProvider(agent).run(req({ permissionMode: 'read' })))
    const r = recorded('mytool')
    expect(r.argv).toEqual(['-p'])
    expect(r.stdin).toContain(READ_ONLY_NOTE)
    await collect(new CustomCliProvider({ ...agent, readOnlyArgs: ['--plan'] }).run(req({ permissionMode: 'read' })))
    expect(recorded('mytool').argv).toEqual(['-p', '--plan'])
    expect(recorded('mytool').stdin).not.toContain(READ_ONLY_NOTE)
  })

  it('Custom (Claude-style JSON): frames mapped like Claude, failed exit is an error', async () => {
    fake('jsontool', [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Four' } } },
      { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 2 } }
    ])
    const { CustomCliProvider } = await import('./CustomCliProvider')
    const agent = { id: 'x-jsontool' as const, name: 'JSON Tool', handle: 'jsontool', command: 'jsontool', bin: 'jsontool', args: [], output: 'claude-stream-json' as const }
    const evs = await collect(new CustomCliProvider(agent).run(req()))
    expect(evs.map((e) => e.type)).toEqual(['session_started', 'text_delta', 'complete'])
    fake('jsontool', [], 1, 'Error: not logged in')
    expect((await collect(new CustomCliProvider(agent).run(req()))).slice(1)).toEqual([{ type: 'error', message: 'not logged in', fatal: true }])
  })

  it('Custom: availability is a PATH lookup', async () => {
    const { CustomCliProvider, whichBin } = await import('./CustomCliProvider')
    expect(whichBin('mytool', process.env)).toBe(join(bin, 'mytool'))
    const missing = { id: 'x-nope' as const, name: 'Nope', handle: 'nope', command: 'nope', bin: 'nope-not-here', args: [], output: 'text' as const }
    expect((await new CustomCliProvider(missing).isAvailable()).installed).toBe(false)
  })
  it('Custom: a preset binary must really be that agent', async () => {
    const { findPresetBin } = await import('./CustomCliProvider')
    // Only the fake bin folder on PATH: a real Cursor install on the machine must not change the answer.
    const env = { ...process.env, PATH: bin }
    fake('agent', [])   // a generic name, not linked to anything that says "cursor"
    expect(findPresetBin('cursor', ['cursor-agent', 'agent'], env)).toBeNull()
    fake('cursor-agent', [])
    expect(findPresetBin('cursor', ['cursor-agent', 'agent'], env)).toBe('cursor-agent')
  })
})
