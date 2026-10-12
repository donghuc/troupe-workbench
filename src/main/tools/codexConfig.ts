// Editing of ~/.codex/config.toml for MCP servers (D-031, hardened in D-068 / audit #11).
// Pure — no Electron, no fs — so it is unit-tested; toolsService.ts does the I/O.
//
// Why line edits + a parser check, not parse → serialize: the file is the user's own,
// hand-written, with comments and ordering a TOML serializer would throw away. So we
// change only our [mcp_servers.<name>] block as text, then parse the old and the new
// file and refuse to write unless (a) the new file is valid TOML, (b) everything
// outside that one server is identical, and (c) the server reads back as intended.
import { parse } from 'smol-toml'

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Server names we write as a bare TOML key. */
export const CODEX_NAME_RE = /^[A-Za-z0-9_-]+$/

// Drop an existing [mcp_servers.<name>] block and its sub-tables ([mcp_servers.<name>.env]),
// in bare or quoted form, from its header line to the next unrelated table header or EOF.
export function removeCodexBlock(lines: string[], name: string): string[] {
  const n = escapeRe(name)
  const mine = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${n}|"${n}"|'${n}')\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`)
  const out: string[] = []
  let skip = false
  for (const ln of lines) {
    if (mine.test(ln)) { skip = true; continue }
    if (skip && /^\s*\[/.test(ln)) skip = false
    if (!skip) out.push(ln)
  }
  return out
}

export interface CodexServerInput {
  name: string
  transport: 'stdio' | 'http'
  commandOrUrl: string
  args?: string[]
  env?: { key: string; value: string }[]
}

function codexBlock(input: CodexServerInput): string[] {
  const block: string[] = [`[mcp_servers.${input.name}]`]
  if (input.transport === 'http') {
    block.push(`url = ${JSON.stringify(input.commandOrUrl.trim())}`)
  } else {
    block.push(`command = ${JSON.stringify(input.commandOrUrl.trim())}`)
    const args = (input.args ?? []).filter((a) => a.trim().length > 0)
    if (args.length) block.push(`args = [${args.map((a) => JSON.stringify(a)).join(', ')}]`)
    const env = (input.env ?? []).filter((e) => e.key.trim())
    if (env.length) block.push(`env = { ${env.map((e) => `${JSON.stringify(e.key.trim())} = ${JSON.stringify(e.value)}`).join(', ')} }`)
  }
  return block
}

type Plan = { ok: true; next: string; changed: boolean } | { ok: false; error: string }
type Table = Record<string, unknown>

const withoutServer = (doc: Table, name: string): Table => {
  const servers = { ...((doc.mcp_servers as Table | undefined) ?? {}) }
  delete servers[name]
  const rest: Table = { ...doc }
  if (Object.keys(servers).length) rest.mcp_servers = servers
  else delete rest.mcp_servers
  return rest
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function tryParse(text: string): Table | string {
  try { return parse(text) as Table } catch (e) { return String((e as Error)?.message ?? e).split('\n')[0] }
}

/**
 * The new file text for adding (input) or removing (input = null) server `name`, or an
 * error explaining why it is not safe to write. `current` is '' for a missing file.
 */
export function planCodexEdit(current: string, name: string, input: CodexServerInput | null): Plan {
  if (!CODEX_NAME_RE.test(name)) return { ok: false, error: `Codex server names may only use letters, digits, - and _ (got "${name}").` }
  const before = tryParse(current)
  if (typeof before === 'string') return { ok: false, error: `~/.codex/config.toml already has a syntax error (${before}); not editing it. Fix the file, then try again.` }
  const had = !!(before.mcp_servers as Table | undefined)?.[name]
  if (!input && !had) return { ok: true, next: current, changed: false }

  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  const out = removeCodexBlock(current ? current.split(/\r?\n/) : [], name)
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  if (input) {
    if (out.length) out.push('')
    out.push(...codexBlock({ ...input, name }))
  }
  const next = out.length ? out.join(eol) + eol : ''

  const after = tryParse(next)
  if (typeof after === 'string') return { ok: false, error: `The edit would make config.toml invalid (${after}); nothing was written.` }
  if (!same(withoutServer(before, name), withoutServer(after, name))) {
    return { ok: false, error: 'The edit would change other settings in config.toml; nothing was written.' }
  }
  const got = (after.mcp_servers as Table | undefined)?.[name] as Table | undefined
  if (input) {
    const want = input.commandOrUrl.trim()
    const key = input.transport === 'http' ? 'url' : 'command'
    if (!got || got[key] !== want) return { ok: false, error: `The new "${name}" entry did not read back correctly; nothing was written.` }
  } else if (got) {
    return { ok: false, error: `Could not remove "${name}" cleanly; nothing was written.` }
  }
  return { ok: true, next, changed: next !== current }
}

/** Server names in a Codex config (top-level [mcp_servers.*] tables only). */
export function codexServerNames(text: string): string[] {
  const doc = tryParse(text)
  if (typeof doc === 'string') return []
  return Object.keys((doc.mcp_servers as Table | undefined) ?? {})
}

/** The default model set in a Codex config (top-level `model = "…"`), or '' if none/invalid. */
export function codexDefaultModel(text: string): string {
  const doc = tryParse(text)
  if (typeof doc === 'string') return ''
  return typeof doc.model === 'string' ? doc.model.trim() : ''
}
