import { describe, it, expect } from 'vitest'
import { parseCommandLine, buildRun, stripAnsi, handleFromName, newAgentId, validateDraft, parseCustomAgents, serializeCustomAgents, draftOf, MAX_ARG_PROMPT, type CustomAgent } from './customAgents'

const agent = (over: Partial<CustomAgent> = {}): CustomAgent => ({ id: 'x-opencode', name: 'OpenCode', handle: 'opencode', command: 'opencode run {prompt}', bin: 'opencode', args: ['run', '{prompt}'], output: 'text', ...over })

describe('parseCommandLine', () => {
  it('splits words with quotes and escapes', () => {
    expect(parseCommandLine('opencode run {prompt}')).toEqual({ ok: true, argv: ['opencode', 'run', '{prompt}'] })
    expect(parseCommandLine(`tool --title "two words" 'it''s' a\\ b`)).toEqual({ ok: true, argv: ['tool', '--title', 'two words', 'its', 'a b'] })
    expect(parseCommandLine('tool ""')).toEqual({ ok: true, argv: ['tool', ''] })
  })
  it('refuses shell features and broken quotes', () => {
    expect(parseCommandLine('tool; rm -rf ~').ok).toBe(false)
    expect(parseCommandLine('tool | tee x').ok).toBe(false)
    expect(parseCommandLine('tool $HOME').ok).toBe(false)
    expect(parseCommandLine('tool "open').ok).toBe(false)
    expect(parseCommandLine('   ').ok).toBe(false)
    expect(parseCommandLine('tool "a;b"')).toEqual({ ok: true, argv: ['tool', 'a;b'] })
  })
})

describe('buildRun', () => {
  it('puts the prompt inside one argument, never splitting it', () => {
    const evil = 'hi"; rm -rf ~ #'
    expect(buildRun(agent(), { prompt: evil })).toEqual({ args: ['run', evil], stdin: '' })
    expect(buildRun(agent({ args: ['--prompt={prompt}'] }), { prompt: 'a b' }).args).toEqual(['--prompt=a b'])
  })
  it('sends the prompt over stdin when there is no {prompt}', () => {
    expect(buildRun(agent({ args: ['-p'] }), { prompt: 'hello' })).toEqual({ args: ['-p'], stdin: 'hello' })
  })
  it('adds the model and read-only flags', () => {
    const a = agent({ modelFlag: '--model', readOnlyArgs: ['--sandbox', 'read-only'] })
    expect(buildRun(a, { prompt: 'p', model: 'deepseek/v4', readOnly: true }).args).toEqual(['run', 'p', '--model', 'deepseek/v4', '--sandbox', 'read-only'])
    expect(buildRun(a, { prompt: 'p' }).args).toEqual(['run', 'p'])
    expect(buildRun(agent({ args: ['-m', '{model}', '{prompt}'] }), { prompt: 'p', model: 'm1' }).args).toEqual(['-m', 'm1', 'p'])
    expect(buildRun(agent({ args: ['{model}', '{prompt}'] }), { prompt: 'p' }).args).toEqual(['p'])
  })
  it('refuses an argument prompt over the cap', () => {
    expect(() => buildRun(agent(), { prompt: 'x'.repeat(MAX_ARG_PROMPT + 1) })).toThrow(/too long/)
    expect(buildRun(agent({ args: [] }), { prompt: 'x'.repeat(MAX_ARG_PROMPT + 1) }).stdin.length).toBe(MAX_ARG_PROMPT + 1)
  })
})

describe('names and output', () => {
  it('strips terminal codes', () => {
    expect(stripAnsi('\u001b[32mOK\u001b[0m done\r\n')).toBe('OK done\n')
    expect(stripAnsi('50%\r100%')).toBe('50%100%')
  })
  it('makes handles and unique ids', () => {
    expect(handleFromName('Cursor CLI')).toBe('cursor-cli')
    expect(handleFromName('  Deep_Seek!! ')).toBe('deep-seek')
    expect(newAgentId('opencode', ['x-opencode'])).toBe('x-opencode-2')
  })
})

describe('validateDraft', () => {
  const draft = { name: 'OpenCode', handle: 'opencode', command: 'opencode run {prompt}', output: 'text' as const }
  it('builds the agent from the form', () => {
    const r = validateDraft({ ...draft, modelFlag: '--model', readOnlyArgs: '--plan' }, [])
    expect(r.ok && r.agent).toMatchObject({ id: 'x-opencode', bin: 'opencode', args: ['run', '{prompt}'], modelFlag: '--model', readOnlyArgs: ['--plan'] })
    if (r.ok) expect(validateDraft(draftOf(r.agent), [r.agent], r.agent.id).ok).toBe(true)
  })
  it('names the field that is wrong', () => {
    expect(validateDraft({ ...draft, name: ' ' }, [])).toMatchObject({ ok: false, field: 'name' })
    expect(validateDraft({ ...draft, handle: 'codex' }, [])).toMatchObject({ ok: false, field: 'handle' })
    expect(validateDraft({ ...draft, handle: 'all' }, [])).toMatchObject({ ok: false, field: 'handle' })
    expect(validateDraft({ ...draft, handle: 'Bad Handle' }, [])).toMatchObject({ ok: false, field: 'handle' })
    expect(validateDraft(draft, [agent()])).toMatchObject({ ok: false, field: 'handle' })
    expect(validateDraft(draft, [agent({ archived: true })]).ok).toBe(true)
    expect(validateDraft({ ...draft, command: 'opencode run; ls' }, [])).toMatchObject({ ok: false, field: 'command' })
  })
})

describe('parseCustomAgents', () => {
  it('round-trips and skips bad entries', () => {
    const list = [agent(), agent({ id: 'x-old', handle: 'old', archived: true })]
    expect(parseCustomAgents(serializeCustomAgents(list))).toEqual(list)
    expect(parseCustomAgents('not json')).toEqual([])
    expect(parseCustomAgents(null)).toEqual([])
    const bad = [agent({ id: 'codex' as never }), agent({ handle: 'claude', id: 'x-c' }), agent(), agent({ id: 'x-dup' }), { id: 'x-n' }]
    expect(parseCustomAgents(JSON.stringify(bad)).map((a) => a.id)).toEqual(['x-opencode'])
  })
})
