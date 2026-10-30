// D-146: how Troupe starts Claude Code so its MCP tools are the same on every turn.
// Measured on Hien's Mac (2026-10-30): claude.ai connectors connect in the background, so a
// turn's first call often went out without Figma/Crowdin and they joined a later call — the
// tool list changed mid-turn and the prompt cache was rewritten. Waiting for them made the
// list stable, but Crowdin alone is 382 tools (~139k tokens per call); tool search lists
// connector tools by name and loads one only when it's used (~8k tokens for all tools).

/** Environment for one `claude` run. Values already in `base` (the user's own shell) win.
 *  `connectors`: the claude.ai connectors Troupe knows of ("claude.ai Figma", …);
 *  `off`: servers switched off in Settings ▸ Tools for Claude. With every known connector
 *  off, Claude doesn't load claude.ai connectors at all (nothing to wait for). */
export function claudeRunEnv(base: Record<string, string | undefined>, connectors: readonly string[], off: ReadonlySet<string>): Record<string, string> {
  const add: Record<string, string> = {
    MCP_CONNECTION_NONBLOCKING: 'false',   // wait for MCP servers before the first call
    ENABLE_TOOL_SEARCH: 'true'             // connector tools by name, loaded when used
  }
  if (connectors.length > 0 && connectors.every((c) => off.has(c))) add.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(add)) if (base[k] === undefined || base[k] === '') out[k] = v
  return out
}

export const isClaudeConnector = (name: string): boolean => /^claude\.ai\s+/.test(name)
