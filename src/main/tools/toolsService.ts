import { app } from 'electron'
import { renameSyncRetry } from '../platform/winFs'
import { execFileCli } from '../platform/proc'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { buildEnv } from '../providers/env'
import type { ProviderId, AgentTools, McpServer, McpAddInput, McpMutationResult } from '../../shared/types'
import { agentEntry, isProviderId } from '../../shared/providers'
import { planCodexEdit, codexServerNames, CODEX_NAME_RE, type CodexServerInput } from './codexConfig'
const CODEX_NAME_OK = (n: string): boolean => CODEX_NAME_RE.test(n)
import { logInfo, logError } from '../util/logger'
import { parseClaudeMcp } from './mcpList'

// Standard (built-in) tools each provider ships with. This is a reference list,
// not a live query — the CLIs don't expose a "list tools" command — so it's
// framed as the provider's standard toolset in the UI. MCP servers below ARE a
// live query.

// Live MCP server names seen from `claude mcp list` — includes account/remote
// connectors (e.g. a Figma connector) that aren't in the local config files the
// fast scan reads, so headless Auto runs can pre-approve them too (B-0xx). Names
// accumulate; a stale name in an allowlist is harmless (matches nothing).
const liveMcpSet = new Set<string>()
function rememberMcpNames(servers: McpServer[]): void { for (const s of servers) if (s.name) liveMcpSet.add(s.name) }
export function liveClaudeMcpNames(): string[] { return [...liveMcpSet] }
export async function refreshLiveMcpNames(cwd?: string): Promise<void> { try { rememberMcpNames(await claudeMcp(cwd)) } catch { /* best-effort */ } }

function claudeMcp(cwd?: string): Promise<McpServer[]> {
  return new Promise((resolve) => {
    execFileCli('claude', ['mcp', 'list'], { env: buildEnv(), cwd, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && !stdout) { resolve([]); return }
      const servers = parseClaudeMcp((stdout || '') + '\n' + (stderr || ''))
      rememberMcpNames(servers)
      resolve(servers)
    })
  })
}

// Best-effort: Codex reads MCP servers from ~/.codex/config.toml [mcp_servers.<name>].
function codexMcp(): McpServer[] {
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8')
    return codexServerNames(toml).map((name) => ({ name, status: 'unknown' as const }))
  } catch { return [] }
}

// Grok's MCP servers (D-133): its own ~/.grok/config.toml [mcp_servers.<name>] AND Claude's
// servers — removing one through Claude removed it from Grok too (Hien's test, 2026-10-21).
// Best-effort: empty if a file is missing or its format differs.
export function grokServers(cwd?: string): { name: string; source: 'grok' | 'claude' }[] {
  const out: { name: string; source: 'grok' | 'claude' }[] = []
  try {
    const toml = readFileSync(join(homedir(), '.grok', 'config.toml'), 'utf8')
    for (const m of toml.matchAll(/^\s*\[mcp_servers\.([^\]]+)\]/gm)) out.push({ name: m[1].trim().replace(/^"|"$/g, ''), source: 'grok' })
  } catch { /* no grok config */ }
  for (const name of configuredClaudeMcpNames(cwd)) if (!out.some((o) => o.name === name)) out.push({ name, source: 'claude' })
  return out
}
function grokMcp(cwd?: string): McpServer[] {
  return grokServers(cwd).map(({ name, source }) => ({ name, status: 'unknown' as const, detail: source === 'grok' ? 'From Grok’s own config (~/.grok/config.toml)' : 'From Claude’s setup — Grok loads Claude’s servers too' }))
}

// Fast (no-spawn) read of the Claude MCP server names configured for this cwd, from
// the config files `claude mcp add` writes: ~/.claude.json (user scope + per-project
// 'local' scope) and <cwd>/.mcp.json (project scope). Used to pre-approve their tools
// for headless runs so MCP tools aren't silently denied (D-030).
function readJson(path: string): any { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
export function configuredClaudeMcpNames(cwd?: string): string[] {
  const names = new Set<string>()
  const home = readJson(join(homedir(), '.claude.json'))
  if (home?.mcpServers) Object.keys(home.mcpServers).forEach((n) => names.add(n))
  if (cwd && home?.projects?.[cwd]?.mcpServers) Object.keys(home.projects[cwd].mcpServers).forEach((n) => names.add(n))
  if (cwd) { const proj = readJson(join(cwd, '.mcp.json')); if (proj?.mcpServers) Object.keys(proj.mcpServers).forEach((n) => names.add(n)) }
  return [...names]
}

export async function listAgentTools(provider: ProviderId, cwd?: string): Promise<AgentTools> {
  const builtin = isProviderId(provider) ? agentEntry(provider).builtinTools : []
  const mcp = provider === 'claude-code' ? await claudeMcp(cwd) : provider === 'grok' ? grokMcp(cwd) : provider === 'gemini' ? [] : codexMcp()   // Gemini's MCP list: not read yet (D-079)
  return { provider, builtin, mcp }
}

function runClaude(args: string[], cwd?: string): Promise<McpMutationResult> {
  return new Promise((resolve) => {
    execFileCli('claude', args, { env: buildEnv(), cwd, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: (stderr || stdout || err.message).trim() })
      else resolve({ ok: true })
    })
  })
}

// --- Codex MCP registration (~/.codex/config.toml) so BOTH runtimes see a server (D-031) ---
const codexConfigPath = (): string => join(homedir(), '.codex', 'config.toml')
// D-068 (audit #11): the edit is planned and verified in codexConfig.ts; here we keep a
// backup of the previous file (config.toml.bak) and write atomically (temp file +
// rename), so a crash mid-write can't leave Codex with a half-written config.
// Returns an error message, or null when Codex is up to date.
function applyCodexEdit(name: string, input: CodexServerInput | null): string | null {
  const p = codexConfigPath()
  let current = ''
  try { current = readFileSync(p, 'utf8') } catch { if (!input) return null /* no file, nothing to remove */ }
  const plan = planCodexEdit(current, name, input)
  if (!plan.ok) { logError(`[codex-config] ${input ? 'add' : 'remove'} ${name} refused: ${plan.error}`); return plan.error }
  if (!plan.changed) return null
  try {
    mkdirSync(dirname(p), { recursive: true })
    if (existsSync(p)) copyFileSync(p, `${p}.bak`)
    const tmp = `${p}.workbench-tmp`
    writeFileSync(tmp, plan.next, 'utf8')
    renameSyncRetry(tmp, p)
    logInfo(`[codex-config] ${input ? 'added' : 'removed'} MCP server "${name}" (previous file kept as config.toml.bak)`)
    return null
  } catch (e) {
    logError(`[codex-config] write failed: ${String(e)}`)
    return `Could not write ~/.codex/config.toml: ${String((e as Error)?.message ?? e)}`
  }
}

// Add a Claude Code MCP server via `claude mcp add`. stdio uses `-- <cmd> [args]`;
// http passes the URL directly with optional -H headers. Args are passed as an
// array (no shell), so values with spaces are safe.
export function addMcpServer(input: McpAddInput, cwd?: string): Promise<McpMutationResult> {
  const name = input.name.trim()
  if (!name || /\s/.test(name)) return Promise.resolve({ ok: false, error: 'Server name is required and cannot contain spaces.' })
  const target = input.commandOrUrl.trim()
  if (!target) return Promise.resolve({ ok: false, error: 'A command (stdio) or URL (http) is required.' })

  // Playwright MCP defaults to writing .playwright-mcp/ (console logs + page snapshots)
  // into the agent's cwd — i.e. the user's project folder. Pin its output to app data
  // so projects don't fill with junk. Covers the browser presets and manual adds.
  const srvArgs = (input.args ?? []).filter((a) => a.trim().length > 0)
  const isPlaywright = input.transport !== 'http' && [target, ...srvArgs].some((a) => a.includes('@playwright/mcp'))
  const effArgs = isPlaywright && !srvArgs.includes('--output-dir')
    ? [...srvArgs, '--output-dir', join(app.getPath('userData'), 'playwright-mcp')]
    : srvArgs

  const args = ['mcp', 'add', '-s', input.scope]
  if (input.transport === 'http') {
    args.push('--transport', 'http', name, target)
    for (const h of input.headers ?? []) if (h.key.trim()) args.push('-H', `${h.key.trim()}: ${h.value}`)
  } else {
    for (const e of input.env ?? []) if (e.key.trim()) args.push('-e', `${e.key.trim()}=${e.value}`)
    args.push(name, '--', target, ...effArgs)
  }
  const codexErr = applyCodexEdit(name, { name, transport: input.transport === 'http' ? 'http' : 'stdio', commandOrUrl: target, args: effArgs, env: input.env })
  return runClaude(args, cwd).then((r) => withCodexNote(r, codexErr, 'Added'))
}

// Claude registration is the primary result; a Codex problem is reported alongside it.
function withCodexNote(r: McpMutationResult, codexErr: string | null, verb: 'Added' | 'Removed'): McpMutationResult {
  if (!codexErr) return r
  return r.ok ? { ok: true, warning: `${verb} for Claude, but not for Codex: ${codexErr}` } : { ...r, error: `${r.error ?? 'Failed.'} Codex: ${codexErr}` }
}

export async function removeMcpServer(name: string, scope?: string, cwd?: string): Promise<McpMutationResult> {
  const args = ['mcp', 'remove', name]
  if (scope) args.push('-s', scope)
  const inGrok = grokServers(cwd).some((g) => g.name === name && g.source === 'grok')
  const codexErr = CODEX_NAME_OK(name) ? applyCodexEdit(name, null) : null
  const r = withCodexNote(await runClaude(args, cwd), codexErr, 'Removed')
  if (!r.ok) return r
  // D-133: say where it went. Grok loads Claude's servers, so removing it from Claude removes it
  // from Grok too — unless it's also in Grok's own config: remove it there with Grok's own command.
  let grokErr: string | null = null
  if (inGrok) grokErr = await new Promise<string | null>((done) => execFileCli('grok', ['mcp', 'remove', name], { env: buildEnv(), cwd, timeout: 30000 }, (err, out, errOut) => done(err ? (errOut || out || err.message).trim().slice(0, 200) : null)))
  if (grokErr) logError(`[grok-config] remove ${name} failed: ${grokErr}`)
  const removedFrom = ['Claude', ...(codexErr ? [] : ['Codex']), ...(grokErr ? [] : ['Grok'])]
  const grokNote = grokErr ? `Grok still has “${name}” in its own config. Remove it in ${process.platform === 'win32' ? 'a terminal' : 'Terminal'}: grok mcp remove ${name}` : ''
  return { ...r, removedFrom, ...(grokNote ? { warning: [r.warning, grokNote].filter(Boolean).join(' ') } : {}) }
}
