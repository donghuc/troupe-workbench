import { describe, it, expect } from 'vitest'
import { claudeRunEnv, isClaudeConnector } from './claudeConnectors'

describe('claudeRunEnv (D-146)', () => {
  const conns = ['claude.ai Figma', 'claude.ai Gmail']
  it('waits for MCP servers and uses tool search', () => {
    expect(claudeRunEnv({}, conns, new Set())).toEqual({ MCP_CONNECTION_NONBLOCKING: 'false', ENABLE_TOOL_SEARCH: 'true' })
  })
  it('skips claude.ai connectors only when every known one is off', () => {
    expect(claudeRunEnv({}, conns, new Set(['claude.ai Gmail'])).ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined()
    expect(claudeRunEnv({}, conns, new Set(conns)).ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false')
    expect(claudeRunEnv({}, [], new Set()).ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined()   // list not read yet
  })
  it("keeps the user's own values", () => {
    expect(claudeRunEnv({ ENABLE_TOOL_SEARCH: 'auto' }, conns, new Set())).toEqual({ MCP_CONNECTION_NONBLOCKING: 'false' })
  })
  it('tells connectors from own servers', () => {
    expect(isClaudeConnector('claude.ai Crowdin')).toBe(true)
    expect(isClaudeConnector('figma-local')).toBe(false)
  })
})
