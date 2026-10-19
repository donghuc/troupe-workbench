import { describe, it, expect } from 'vitest'
import { parseDomains, claudeSandboxSettings, sandboxOn, DEFAULT_SHELL_DOMAINS } from './shellSandbox'

describe('parseDomains', () => {
  it('takes lines or commas, drops scheme and path, skips junk', () => {
    expect(parseDomains('https://api.example.com/v1\n*.figma.com, localhost:3000\nnot a domain\n\nexample')).toEqual(['api.example.com', '*.figma.com', 'localhost:3000'])
  })
  it('dedupes and lowercases', () => { expect(parseDomains('A.com\na.com')).toEqual(['a.com']) })
  it('handles empty', () => { expect(parseDomains(null)).toEqual([]) })
})

describe('claudeSandboxSettings', () => {
  const s = JSON.parse(claudeSandboxSettings(['api.example.com', 'github.com'])).sandbox
  it('fails closed', () => {
    expect(s.enabled).toBe(true)
    expect(s.allowUnsandboxedCommands).toBe(false)
    expect(s.failIfUnavailable).toBe(true)
    expect(s.network.strictAllowlist).toBe(true)
  })
  it('allows defaults plus extras, once each', () => {
    expect(s.network.allowedDomains).toEqual([...DEFAULT_SHELL_DOMAINS, 'api.example.com'])
  })
  it('blocks credential folders', () => { expect(s.filesystem.denyRead).toContain('~/.ssh') })
})

describe('sandboxOn', () => {
  it('is on unless switched off', () => { expect(sandboxOn(null)).toBe(true); expect(sandboxOn('1')).toBe(true); expect(sandboxOn('0')).toBe(false) })
})
