// MCP servers on/off (D-075, made global in D-077). Every agent run loads every
// configured MCP server; servers switched off in Settings ▸ Tools are left out of every
// run, so their tool definitions stop costing tokens. Setting `mcp_off` = JSON array of
// "<providerId>:<server name>". D-075's per-project lists (`project_mcp_off:<id>`) are
// folded into it once at startup. Pure; tested.
import type { ProviderId } from './types'

export const MCP_OFF_SETTING = 'mcp_off'
export const LEGACY_PROJECT_MCP_PREFIX = 'project_mcp_off:'

/** D-077 migration: the union of the old per-project lists, sorted and de-duplicated. */
export function mergeMcpOffLists(raws: (string | null | undefined)[]): string[] {
  return [...new Set(raws.flatMap((r) => parseMcpOff(r)))].sort()
}
export const mcpOffKey = (provider: ProviderId, name: string): string => `${provider}:${name}`

export function parseMcpOff(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.includes(':')) : [] } catch { return [] }
}

/** Server names switched off for one agent. */
export function mcpOffFor(raw: string | null | undefined, provider: ProviderId): string[] {
  const prefix = `${provider}:`
  return parseMcpOff(raw).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).filter(Boolean)
}

/** Codex: `-c mcp_servers.<name>.enabled=false` per server (verified with codex-cli 0.156).
 *  Only for servers defined in Codex's own config: an override for any other name makes Codex
 *  treat it as a new, incomplete server and refuse to start ("invalid transport") — seen with
 *  a Claude connector name ("claude.ai Crowdin") in the list (D-077 fix). */
export function codexMcpOffArgs(names: string[], configured?: readonly string[]): string[] {
  const known = configured ? new Set(configured) : null
  return names.filter((n) => !known || known.has(n)).flatMap((n) => ['-c', `mcp_servers.${/^[A-Za-z0-9_-]+$/.test(n) ? n : JSON.stringify(n)}.enabled=false`])
}

/** Claude namespaces MCP tools as mcp__<server>__<tool>. Dots and spaces in the server
 *  name become `_` ("claude.ai Figma" → mcp__claude_ai_Figma, B-029) but dashes are KEPT
 *  (mcp__claude-in-chrome__navigate). B-050: "market-data" was allow-listed as mcp__market_data,
 *  matched nothing, and every call was refused. Keep `-`; and because the exact rule is
 *  Claude's to change, callers get both spellings for a dashed name — an extra allowlist
 *  entry that matches nothing is harmless. */
export const claudeMcpToolPrefix = (name: string): string => `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
export function claudeMcpToolPrefixes(name: string): string[] {
  const keep = claudeMcpToolPrefix(name)
  const flat = keep.replace(/-/g, '_')
  return flat === keep ? [keep] : [keep, flat]
}

// How an MCP server name reads in the UI. Claude lists plugin servers as
// "plugin:<plugin>:<server>" and account connectors as "claude.ai <Name>"; neither
// can be removed with `claude mcp remove` (plugins via /plugin, connectors on claude.ai).
export type McpKind = 'own' | 'connector' | 'plugin'
export function mcpDisplay(name: string): { label: string; source?: string; removable: boolean; kind: McpKind; plugin?: string } {
  const p = /^plugin:([^:]+):(.+)$/.exec(name)
  if (p) return { label: p[2], source: p[1] === p[2] ? 'plugin' : `plugin ${p[1]}`, removable: false, kind: 'plugin', plugin: p[1] }
  const c = /^claude\.ai\s+(.+)$/.exec(name)
  if (c) return { label: c[1], source: 'claude.ai', removable: false, kind: 'connector' }
  return { label: name, removable: true, kind: 'own' }
}

/** Settings ▸ Tools grouping: your servers, account connectors, then one group per plugin. */
export function groupMcpServers<T extends { name: string }>(servers: T[]): { own: T[]; connectors: T[]; plugins: { plugin: string; servers: T[] }[] } {
  const own: T[] = []; const connectors: T[] = []; const byPlugin = new Map<string, T[]>()
  for (const s of servers) {
    const d = mcpDisplay(s.name)
    if (d.kind === 'plugin') byPlugin.set(d.plugin!, [...(byPlugin.get(d.plugin!) ?? []), s])
    else (d.kind === 'connector' ? connectors : own).push(s)
  }
  return { own, connectors, plugins: [...byPlugin].map(([plugin, list]) => ({ plugin, servers: list })).sort((a, b) => a.plugin.localeCompare(b.plugin)) }
}
