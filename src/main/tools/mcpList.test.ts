import { describe, it, expect } from 'vitest'
import { parseClaudeMcp } from './mcpList'

describe('parseClaudeMcp', () => {
  it('keeps full plugin server names and account connector names', () => {
    const out = [
      'Checking MCP server health...',
      '',
      'plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✓ Connected',
      'plugin:context7:context7: npx -y @upstash/context7-mcp - ⏸ Pending',
      'claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ✓ Connected',
      'playwright: npx @playwright/mcp@latest - ✗ Failed to connect',
      'market-data: https://mcp.example.com/mcp (HTTP) - ✗ Needs authentication'
    ].join('\n')
    expect(parseClaudeMcp(out).map((s) => [s.name, s.status])).toEqual([
      ['plugin:figma:figma', 'connected'],
      ['plugin:context7:context7', 'pending'],
      ['claude.ai Gmail', 'connected'],
      ['playwright', 'failed'],
      ['market-data', 'pending'] // OAuth sign-in pending, not broken
    ])
  })
  it('returns nothing when there are no servers', () => {
    expect(parseClaudeMcp('No MCP servers configured.')).toEqual([])
  })
})
