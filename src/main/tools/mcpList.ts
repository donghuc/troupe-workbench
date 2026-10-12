import type { McpServer } from '../../shared/types'

// Pure parsing of `claude mcp list` (no electron imports, so it is unit-tested).

function mcpStatus(s: string): McpServer['status'] {
  const t = s.toLowerCase()
  if (s.includes('✓') || t.includes('connected')) return 'connected'
  // "✗ Needs authentication" is an OAuth server waiting for a one-time sign-in, not a
  // broken one — check before the ✗ so the UI can say "sign in" instead of "failed".
  if (s.includes('⏸') || t.includes('pending') || t.includes('auth')) return 'pending'
  if (s.includes('✗') || t.includes('failed')) return 'failed'
  return 'unknown'
}

// Each line is "<name>: <command or url> - <status>". Names can contain colons —
// plugin servers are listed as "plugin:<plugin>:<server>" — so the name ends at the
// first colon followed by whitespace, not the first colon (D-075 follow-up: every
// plugin server showed as just "plugin").
export function parseClaudeMcp(out: string): McpServer[] {
  if (/no mcp servers/i.test(out)) return []
  const servers: McpServer[] = []
  for (const raw of out.split('\n')) {
    const line = raw.trim()
    if (!line || /^checking mcp/i.test(line)) continue
    const m = /^(.+?):\s+(.*)$/.exec(line)
    if (!m) continue
    const name = m[1].trim()
    if (!name) continue
    const rest = m[2].trim()
    const dash = rest.lastIndexOf(' - ')
    const detail = (dash >= 0 ? rest.slice(0, dash) : rest).trim()
    const statusText = dash >= 0 ? rest.slice(dash + 3).trim() : ''
    servers.push({ name, detail: detail || undefined, status: mcpStatus(statusText || detail) })
  }
  return servers
}
