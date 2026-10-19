import { describe, it, expect } from 'vitest'
import { encodeRunId, decodeRunId, pickOne, parseMode, titleFrom, clampLast, clampWait, statusText, CliError } from './cliProtocol'

const items = [
  { id: 'aaaaaaaa-1111', name: 'Workbench sandbox' },
  { id: 'bbbbbbbb-2222', name: 'Personal finance' },
  { id: 'cccccccc-3333', name: 'Workbench docs' }
]
const name = (t: { name: string }) => t.name

describe('run ids', () => {
  it('round-trips the chat id and send time', () => {
    const id = '6f1c2a3e-1234-4abc-9def-001122334455'
    const r = encodeRunId(id, 1792382133466)
    expect(decodeRunId(r)).toEqual({ chatId: id, sentAt: 1792382133466 })
  })
  it('refuses anything else', () => {
    expect(() => decodeRunId('../../etc')).toThrow(CliError)
    expect(() => decodeRunId('abc')).toThrow(/Not a run id/)
  })
})

describe('pickOne', () => {
  it('takes an id, an id prefix, an exact name, or a unique partial name', () => {
    expect(pickOne(items, 'bbbbbbbb-2222', name, 'project').name).toBe('Personal finance')
    expect(pickOne(items, 'cccccc', name, 'project').name).toBe('Workbench docs')
    expect(pickOne(items, 'personal FINANCE', name, 'project').id).toBe('bbbbbbbb-2222')
    expect(pickOne(items, 'finance', name, 'project').id).toBe('bbbbbbbb-2222')
  })
  it('says which ones match when a name is ambiguous', () => {
    expect(() => pickOne(items, 'Workbench', name, 'project')).toThrow(/matches 2 projects: Workbench sandbox \(aaaaaaaa\), Workbench docs \(cccccccc\)/)
  })
  it('404s on no match and refuses an empty name', () => {
    try { pickOne(items, 'nope', name, 'project'); throw new Error('no throw') } catch (e) { expect((e as CliError).status).toBe(404) }
    expect(() => pickOne(items, '  ', name, 'project')).toThrow(/Name a project/)
  })
})

describe('parseMode', () => {
  it('defaults to Auto and accepts read', () => {
    expect(parseMode(undefined)).toBe('auto')
    expect(parseMode('READ')).toBe('read')
    expect(parseMode('read-only')).toBe('read')
  })
  it('never allows Full access', () => {
    expect(() => parseMode('full')).toThrow(/Full access is not available/)
    expect(() => parseMode('yolo')).toThrow(/Unknown mode/)
  })
})

describe('small helpers', () => {
  it('titles a chat from the first line, trimmed', () => {
    expect(titleFrom('  summarise PLAN.md\nand more')).toBe('summarise PLAN.md')
    expect(titleFrom('x'.repeat(80))).toHaveLength(58)
  })
  it('clamps --last and --wait', () => {
    expect(clampLast('5')).toBe(5); expect(clampLast('9999')).toBe(200); expect(clampLast('abc')).toBe(10)
    expect(clampWait('600')).toBe(600); expect(clampWait('99999')).toBe(900); expect(clampWait(null)).toBe(0)
  })
  it('shows times in local time', () => {
    const t = new Date(2026, 9, 19, 15, 32).getTime()
    expect(statusText({ run: 'r', chat: 'c', state: 'done', replies: [{ role: 'assistant', agent: 'Claude', text: 'hi', at: t }], partial: [], error: null })).toContain('Claude · 2026-10-19 15:32')
  })
  it('prints status for a bot to read', () => {
    expect(statusText({ run: 'r', chat: 'c', state: 'running', replies: [], partial: [{ agent: 'Claude', text: 'Working on' }], error: null })).toBe('run r: running\n\n── Claude (so far)\nWorking on')
    expect(statusText({ run: 'r', chat: 'c', state: 'done', replies: [{ role: 'assistant', agent: 'Codex', text: 'Done.', at: 0 }], partial: [], error: null })).toMatch(/^run r: done\n\n── Codex · \d{4}-\d{2}-\d{2} \d{2}:\d{2}\nDone\.$/)
  })
})
