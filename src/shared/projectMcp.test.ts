import { describe, it, expect } from 'vitest'
import { claudeMcpToolPrefixes, parseMcpOff, mcpOffFor, codexMcpOffArgs, claudeMcpToolPrefix, mcpOffKey, mcpDisplay, mergeMcpOffLists, groupMcpServers } from './projectMcp'

describe('per-project MCP servers (D-075)', () => {
  const raw = JSON.stringify([mcpOffKey('codex', 'crowdin'), mcpOffKey('codex', 'computer-use'), mcpOffKey('claude-code', 'claude.ai Figma'), 7, 'junk'])
  it('parses the setting per agent, ignoring junk', () => {
    expect(mcpOffFor(raw, 'codex')).toEqual(['crowdin', 'computer-use'])
    expect(mcpOffFor(raw, 'claude-code')).toEqual(['claude.ai Figma'])
    expect(mcpOffFor(raw, 'grok')).toEqual([])
    expect(parseMcpOff('not json')).toEqual([])
  })
  it('builds Codex overrides, quoting unusual names', () => {
    expect(codexMcpOffArgs(['crowdin', 'my server'])).toEqual(['-c', 'mcp_servers.crowdin.enabled=false', '-c', 'mcp_servers."my server".enabled=false'])
  })
  it('matches Claude’s MCP tool naming', () => {
    expect(claudeMcpToolPrefix('claude.ai Figma')).toBe('mcp__claude_ai_Figma')
    // B-050: dashes are kept (mcp__claude-in-chrome__navigate is a real tool name)
    expect(claudeMcpToolPrefix('market-data')).toBe('mcp__market-data')
    expect(claudeMcpToolPrefixes('market-data')).toEqual(['mcp__market-data', 'mcp__market_data'])
    expect(claudeMcpToolPrefixes('playwright')).toEqual(['mcp__playwright'])
  })
  it('mcpDisplay names plugin and claude.ai servers', () => {
    expect(mcpDisplay('plugin:figma:figma')).toEqual({ label: 'figma', source: 'plugin', removable: false, kind: 'plugin', plugin: 'figma' })
    expect(mcpDisplay('plugin:tools:github')).toEqual({ label: 'github', source: 'plugin tools', removable: false, kind: 'plugin', plugin: 'tools' })
    expect(mcpDisplay('claude.ai Gmail')).toEqual({ label: 'Gmail', source: 'claude.ai', removable: false, kind: 'connector' })
    expect(mcpDisplay('playwright')).toEqual({ label: 'playwright', removable: true, kind: 'own' })
  })
  it('merges the old per-project lists into one global list (D-077)', () => {
    expect(mergeMcpOffLists(['["claude-code:b","codex:x"]', null, '["claude-code:b","claude-code:a"]', 'junk'])).toEqual(['claude-code:a', 'claude-code:b', 'codex:x'])
  })
  it('groups servers by where they come from', () => {
    const g = groupMcpServers([{ name: 'plugin:design:slack' }, { name: 'claude.ai Gmail' }, { name: 'playwright' }, { name: 'plugin:design:figma' }, { name: 'plugin:ab:x' }])
    expect(g.own.map((s) => s.name)).toEqual(['playwright'])
    expect(g.connectors.map((s) => s.name)).toEqual(['claude.ai Gmail'])
    expect(g.plugins.map((p) => [p.plugin, p.servers.length])).toEqual([['ab', 1], ['design', 2]])
  })
  it('only switches off servers Codex actually has (D-077 fix)', () => {
    expect(codexMcpOffArgs(['claude.ai Crowdin', 'crowdin'], ['crowdin', 'figma'])).toEqual(['-c', 'mcp_servers.crowdin.enabled=false'])
    expect(codexMcpOffArgs(['claude.ai Crowdin'], [])).toEqual([])
  })
})
