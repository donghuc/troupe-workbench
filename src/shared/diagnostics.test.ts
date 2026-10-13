import { describe, it, expect } from 'vitest'
import { scrubDiagnostics, tailLines, buildDiagnostics } from './diagnostics'

describe('copy diagnostics (D-103)', () => {
  it('replaces the home folder and other account paths', () => {
    const s = scrubDiagnostics('opened /Users/hien/Documents/Atlas and /Users/other/x', '/Users/hien')
    expect(s).toContain('~/Documents/Atlas')
    expect(s).not.toContain('hien')
    expect(s).toContain('/Users/…/x')
  })
  it('masks keys and tokens', () => {
    const s = scrubDiagnostics('key sk-ant-abcdefghijklmnop1234 gh ghp_abcdefghijklmnopqrstuvwxyz Authorization: Bearer abcdefghijklmnopqrstuvwx', '/Users/h')
    expect(s).not.toMatch(/sk-ant-abcdef/)
    expect(s).not.toMatch(/ghp_abcdef/)
    expect(s).not.toMatch(/abcdefghijklmnopqrstuvwx/)
    expect(s).toContain('[redacted]')
  })
  it('keeps the last lines of a log', () => {
    expect(tailLines('a\nb\nc\nd\n', 2)).toBe('c\nd')
  })
  it('builds a pasteable block with agent states', () => {
    const t = buildDiagnostics({
      app: { version: '2.2.0', electron: '44', node: '22', platform: 'darwin', arch: 'arm64', os: 'macOS 26.0' },
      agents: [
        { name: 'Claude', installed: true, authenticated: true, enabled: true, detail: '2.1 · Signed in' },
        { name: 'Codex', installed: true, authenticated: false, enabled: false },
        { name: 'Grok', installed: false, authenticated: false, enabled: false }
      ],
      logTail: 'line at /Users/h/proj',
      home: '/Users/h'
    })
    expect(t).toContain('Troupe 2.2.0')
    expect(t).toContain('- Claude: ready — 2.1 · Signed in')
    expect(t).toContain('- Codex: not signed in (switched off)')
    expect(t).toContain('- Grok: not installed (switched off)')
    expect(t).toContain('~/proj')
  })
})
