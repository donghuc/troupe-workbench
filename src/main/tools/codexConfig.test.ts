import { describe, it, expect } from 'vitest'
import { removeCodexBlock, escapeRe, planCodexEdit, codexServerNames, codexDefaultModel } from './codexConfig'

const cfg = [
  'model = "gpt-5"',
  '',
  '[mcp_servers.playwright]',
  'command = "npx"',
  'args = ["@playwright/mcp"]',
  '',
  '[mcp_servers.figma]',
  'url = "https://mcp.figma.com"',
  '',
  '[features]',
  'memories = true'
]

describe('removeCodexBlock', () => {
  it('removes exactly the named block and keeps everything else', () => {
    const out = removeCodexBlock(cfg, 'playwright')
    expect(out).toEqual(['model = "gpt-5"', '', '[mcp_servers.figma]', 'url = "https://mcp.figma.com"', '', '[features]', 'memories = true'])
  })
  it('stops at the next table header, so a following block survives', () => {
    const out = removeCodexBlock(cfg, 'figma')
    expect(out).toContain('[features]')
    expect(out).toContain('memories = true')
    expect(out).not.toContain('url = "https://mcp.figma.com"')
  })
  it('is a no-op for an unknown name', () => {
    expect(removeCodexBlock(cfg, 'nope')).toEqual(cfg)
  })
  it('does not match a name that is only a prefix of another', () => {
    expect(removeCodexBlock(cfg, 'play')).toEqual(cfg)
  })
  it('treats regex metacharacters in the name literally', () => {
    const lines = ['[mcp_servers.a.b]', 'x = 1', '[mcp_servers.aXb]', 'y = 2']
    expect(removeCodexBlock(lines, 'a.b')).toEqual(['[mcp_servers.aXb]', 'y = 2'])
    expect(escapeRe('a.b')).toBe('a\\.b')
  })
})

const real = [
  '# my codex config',
  'model = "gpt-5.6-sol"   # default',
  'approval_policy = "on-request"',
  '',
  '[mcp_servers.playwright]',
  'command = "npx"',
  'args = ["@playwright/mcp"]',
  '',
  '[mcp_servers.playwright.env]',
  'DEBUG = "1"',
  '',
  '[features]',
  'memories = true',
  ''
].join('\n')

describe('planCodexEdit (D-068)', () => {
  it('adds a server and keeps comments and every other setting byte-for-byte', () => {
    const r = planCodexEdit(real, 'figma', { name: 'figma', transport: 'http', commandOrUrl: 'https://mcp.figma.com/mcp' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.next.startsWith(real.trimEnd())).toBe(true)
    expect(r.next).toContain('[mcp_servers.figma]\nurl = "https://mcp.figma.com/mcp"')
    expect(codexServerNames(r.next)).toEqual(['playwright', 'figma'])
  })
  it('removes a server together with its sub-tables', () => {
    const r = planCodexEdit(real, 'playwright', null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.next).not.toContain('playwright')
    expect(r.next).not.toContain('DEBUG')
    expect(r.next).toContain('# my codex config')
    expect(r.next).toContain('[features]\nmemories = true')
  })
  it('replaces an existing server instead of duplicating it', () => {
    const r = planCodexEdit(real, 'playwright', { name: 'playwright', transport: 'stdio', commandOrUrl: 'npx', args: ['@playwright/mcp@latest'] })
    expect(r.ok && codexServerNames(r.next)).toEqual(['playwright'])
    expect(r.ok && r.next).toContain('@playwright/mcp@latest')
  })
  it('refuses to touch a file that is already invalid', () => {
    const r = planCodexEdit('model = \n[broken', 'x', null)
    expect(r.ok).toBe(false)
  })
  it('refuses unsafe server names', () => {
    expect(planCodexEdit(real, 'a]b', null).ok).toBe(false)
    expect(planCodexEdit(real, 'has space', null).ok).toBe(false)
  })
  it('is a no-op when removing a server that is not there', () => {
    const r = planCodexEdit(real, 'nope', null)
    expect(r).toEqual({ ok: true, next: real, changed: false })
  })
  it('removes a server whose only other table is its own sub-table', () => {
    const tricky = '[mcp_servers.a]\ncommand = "x"\n[mcp_servers.a.env]\nK = "v"\n'
    const r = planCodexEdit(tricky, 'a', null)
    expect(r.ok && codexServerNames(r.next)).toEqual([])
  })
  it('creates the file content from scratch', () => {
    const r = planCodexEdit('', 'figma', { name: 'figma', transport: 'http', commandOrUrl: 'https://x' })
    expect(r.ok && r.next).toBe('[mcp_servers.figma]\nurl = "https://x"\n')
  })
})

describe('codexDefaultModel (D-073)', () => {
  it('reads the top-level model, ignoring comments and tables', () => {
    expect(codexDefaultModel('# x\nmodel = "gpt-5.6-sol"  # default\n[mcp_servers.a]\nmodel = "nope"\n')).toBe('gpt-5.6-sol')
    expect(codexDefaultModel('[features]\nx = 1\n')).toBe('')
    expect(codexDefaultModel('broken = \n[')).toBe('')
  })
})

