import { IS_WINDOWS, relUnder } from './platform'
import { formatDuration } from './collabChecks'
// Command-line access (D-117). Pure pieces of the `troupe` CLI protocol: run ids, name
// matching, mode checks and the plain-text output a bot or a person reads. The server
// (main/cli) and its tests use these; nothing here touches Electron or the database.

export const CLI_ACCESS_SETTING = 'cli_access'          // '1' = the socket is open
export const CLI_SOCKET_NAME = 'troupe.sock'            // in the app's userData folder
export const CLI_MAX_MESSAGE = 100_000                  // characters per message
const CLI_MAX_WAIT_S = 900                       // `status --wait` cap

export class CliError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'CliError' }
}

/** A run id names the chat and the moment the message was sent, so it survives app restarts. */
export function encodeRunId(chatId: string, sentAt: number): string { return `${chatId}.${sentAt.toString(36)}` }
export function decodeRunId(run: string): { chatId: string; sentAt: number } {
  const m = /^([0-9a-f-]{8,64})\.([0-9a-z]{6,12})$/i.exec(run.trim())
  if (!m) throw new CliError(`Not a run id: ${run}`, 404)
  return { chatId: m[1], sentAt: parseInt(m[2], 36) }
}

/** One item by id, then exact name (any case), then a unique start-of-name or contained match. */
export function pickOne<T extends { id: string }>(items: T[], query: string, name: (t: T) => string, kind: string): T {
  const q = query.trim(); const lq = q.toLowerCase()
  if (!q) throw new CliError(`Name a ${kind}.`)
  const byId = items.find((t) => t.id === q) ?? (q.length >= 6 ? one(items.filter((t) => t.id.startsWith(q))) : undefined)
  if (byId) return byId
  const exact = items.filter((t) => name(t).toLowerCase() === lq)
  if (exact.length === 1) return exact[0]
  const starts = items.filter((t) => name(t).toLowerCase().startsWith(lq))
  if (starts.length === 1) return starts[0]
  const contains = items.filter((t) => name(t).toLowerCase().includes(lq))
  if (contains.length === 1) return contains[0]
  const many = exact.length > 1 ? exact : starts.length > 1 ? starts : contains
  if (many.length > 1) throw new CliError(`"${q}" matches ${many.length} ${kind}s: ${many.slice(0, 6).map((t) => `${name(t)} (${t.id.slice(0, 8)})`).join(', ')}. Use the id.`)
  throw new CliError(`No ${kind} called "${q}".`, 404)
}
const one = <T>(xs: T[]): T | undefined => (xs.length === 1 ? xs[0] : undefined)

/** Bots may read or work in Auto (sandboxed); Full access is never offered over the CLI. */
export function parseMode(v: string | null | undefined): 'read' | 'auto' {
  const m = (v ?? '').trim().toLowerCase()
  if (!m || m === 'auto') return 'auto'
  if (m === 'read' || m === 'read-only' || m === 'readonly') return 'read'
  if (m === 'full') throw new CliError('Full access is not available from the command line. Use --mode read or auto.')
  throw new CliError(`Unknown mode "${v}". Use read or auto.`)
}

/** A new chat's title: the message's first line, trimmed to a sidebar-friendly length. */
export function titleFrom(message: string): string {
  const first = message.trim().split(/\r?\n/)[0].replace(/\s+/g, ' ').trim()
  return first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first || 'New chat'
}

export function clampLast(v: string | null | undefined, fallback = 10): number {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : fallback
}
export function clampWait(v: string | null | undefined): number {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(CLI_MAX_WAIT_S, Math.floor(n)) : 0
}

// ── plain-text output ───────────────────────────────────────────────────────────
export interface CliProject { id: string; name: string; folder: string | null; chats: number }
export interface CliChat { id: string; title: string; agent: string; updatedAt: number; busy: boolean }
export interface CliMessage { role: 'user' | 'assistant'; agent: string | null; text: string; at: number }
export interface CliStatus { run: string; chat: string; state: 'running' | 'done' | 'error' | 'stopped'; replies: CliMessage[]; partial: { agent: string; text: string }[]; error: string | null; files?: string[] }

// Local time, like the app shows it: "2026-10-19 15:32".
const pad = (n: number): string => String(n).padStart(2, '0')
const when = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }

export function projectsText(ps: CliProject[]): string {
  if (!ps.length) return 'No projects.'
  return ps.map((p) => `${p.id}  ${p.name}  (${p.chats} chat${p.chats === 1 ? '' : 's'})${p.folder ? `  ${p.folder}` : ''}`).join('\n')
}
export function chatsText(cs: CliChat[]): string {
  if (!cs.length) return 'No chats in this project.'
  return cs.map((c) => `${c.id}  ${when(c.updatedAt)}  ${c.agent}${c.busy ? '  [running]' : ''}  ${c.title}`).join('\n')
}
export function messagesText(ms: CliMessage[]): string {
  if (!ms.length) return 'No messages yet.'
  return ms.map((m) => `── ${m.role === 'user' ? 'You' : m.agent ?? 'Assistant'} · ${when(m.at)}\n${m.text.trim()}`).join('\n\n')
}
export function statusText(s: CliStatus): string {
  const head = `run ${s.run}: ${s.state}`
  if (s.state === 'running') {
    const live = s.partial.filter((p) => p.text.trim())
    return live.length ? `${head}\n\n${live.map((p) => `── ${p.agent} (so far)\n${p.text.trim()}`).join('\n\n')}` : `${head} (no reply text yet)`
  }
  const body = s.replies.length ? '\n\n' + messagesText(s.replies) : ''
  const files = s.files?.length ? `\n\nFiles changed (${s.files.length}):\n${s.files.map((f) => `  ${f}`).join('\n')}` : ''
  return `${head}${s.error ? `\nerror: ${s.error}` : ''}${body}${files}`
}

// ── D-118: more commands (runs, schedules, files, attachments, search, context, Collab) ──

export const CLI_MAX_ATTACH = 5
export const CLI_MAX_ATTACH_BYTES = 20 * 1024 * 1024

/** One line of the run log: a chat turn that finished (any source) or a Collab run started from the CLI. */
export interface RunLogEntry {
  run: string                       // encodeRunId(chat, user message time); collab: the Collab run id
  kind: 'chat' | 'collab'
  chat: string
  project: string                   // project name at the time
  title: string
  source: 'app' | 'cli' | 'schedule'
  agents: string[]
  startedAt: number
  finishedAt: number
  state: 'done' | 'error' | 'stopped' | 'started'
  error: string | null
  files: string[]                   // files the agents edited (project-relative where possible)
}

/** "--since" values: 10:00 (today, local), 2h / 30m / 1d (ago), or an ISO date. */
export function parseSince(v: string | null | undefined, now = Date.now()): number {
  const s = (v ?? '').trim()
  if (!s) return now - 24 * 3600_000
  const rel = /^(\d+)\s*([mhd])$/i.exec(s)
  if (rel) return now - Number(rel[1]) * ({ m: 60_000, h: 3600_000, d: 86_400_000 } as Record<string, number>)[rel[2].toLowerCase()]
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (hm) { const d = new Date(now); d.setHours(Number(hm[1]), Number(hm[2]), 0, 0); return d.getTime() }
  const t = Date.parse(s)
  if (Number.isFinite(t)) return t
  throw new CliError(`Can't read --since "${s}". Use 10:00, 2h, 1d or a date like 2026-10-19.`)
}

const MODES_THINK = ['debate', 'critique', 'research'] as const
export type ThinkMode = typeof MODES_THINK[number]
export function parseThink(v: string | null | undefined): ThinkMode | undefined {
  const m = (v ?? '').trim().toLowerCase()
  if (!m) return undefined
  if ((MODES_THINK as readonly string[]).includes(m)) return m as ThinkMode
  throw new CliError(`Unknown --think "${v}". Use debate, critique or research.`)
}

/** Files the CLI never reads, lists or attaches: keys, tokens and credential stores. */
export function isSecretPath(p: string): boolean {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  const base = (parts[parts.length - 1] ?? '').toLowerCase()
  if (parts.some((x) => ['.ssh', '.aws', '.gnupg', '.git', '.docker', 'keychains', '.kube'].includes(x.toLowerCase()))) return true
  return /^\.env(\..*)?$/.test(base) || /\.(pem|key|p12|pfx|keystore|jks|kdbx)$/.test(base) ||
    /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(base) || /^(\.netrc|\.npmrc|\.pypirc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/.test(base)
}

/** Files edited by a run, from its replies' recorded actions; project-relative when inside `root`. */
const WRITE_TOOL = /^(write|edit|multiedit|notebookedit|write_file|edit_file|create_file|apply_patch|str_replace_editor|replace)$/i
export function filesChanged(metas: (Record<string, unknown> | null)[], root?: string | null): string[] {
  const out: string[] = []
  for (const m of metas) {
    const acts = Array.isArray(m?.actions) ? (m!.actions as { kind?: string; label?: string; path?: string }[]) : []
    for (const a of acts) {
      if (!a?.path || !(a.kind === 'file' || (a.kind === 'tool' && WRITE_TOOL.test(a.label ?? '')))) continue
      let p = a.path
      if (IS_WINDOWS) { const u = root ? relUnder(p, root) : null; p = u ?? p }   // D-120: C:\… paths
      else if (root && p.startsWith(root.replace(/\/$/, '') + '/')) p = p.slice(root.replace(/\/$/, '').length + 1)
      if (!out.includes(p)) out.push(p)
    }
  }
  return out
}

export function runsText(rs: RunLogEntry[]): string {
  if (!rs.length) return 'No runs in that period.'
  return rs.map((r) => {
    const mark = r.state === 'done' ? 'done' : r.state === 'started' ? 'started' : r.state.toUpperCase()
    const files = r.files.length ? `  · ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed` : ''
    return `${when(r.finishedAt)}  ${mark.padEnd(7)}  ${r.source.padEnd(8)}  ${r.project} · ${r.title}${r.kind === 'collab' ? ' (Collab)' : ''}  [${r.agents.join(', ')}]${files}\n  run ${r.run}${r.error ? `\n  error: ${r.error}` : ''}`
  }).join('\n')
}

export interface CliSchedule { id: string; title: string; project: string; agent: string; when: string; enabled: boolean; nextRunAt: number; lastRunAt: number | null; chat: string | null }
export function schedulesText(ss: CliSchedule[]): string {
  if (!ss.length) return 'No scheduled tasks.'
  return ss.map((s) => `${s.id}  ${s.enabled ? '' : '[off] '}${s.title} · ${s.project} · ${s.agent} · ${s.when}\n  next ${s.enabled ? when(s.nextRunAt) : '—'} · last ${s.lastRunAt ? when(s.lastRunAt) : 'never'}`).join('\n')
}
export function describeSchedule(kind: string, intervalMin: number, atMin: number): string {
  if (kind === 'daily') return `daily at ${pad(Math.floor(atMin / 60))}:${pad(atMin % 60)}`
  return intervalMin % 60 === 0 ? `every ${intervalMin / 60} h` : `every ${intervalMin} min`
}

export interface CliCollabTask { n: number; title: string; status: string; kind?: string; agent: string; reviewer: string; attempts: number; tries: string; produces: string; findings: string[]; files: string[]; startedAt: number | null; finishedAt: number | null; seconds: number | null }
export interface CliCollab { run: string; chat: string; project: string; goal: string; status: string; reason: string; tasks: CliCollabTask[]; fixes: { n: number; label: string; recommended: boolean; needsYou: string | null; changesGoal?: boolean }[]; summary: string; wrapUp: string }
export function collabText(c: CliCollab): string {
  const human = (s: string) => s.replace(/_/g, ' ')
  const lines = [`collab ${c.run}: ${human(c.status)}${c.reason ? ` — ${c.reason}` : ''}`, `goal: ${c.goal}`, `chat ${c.chat} in ${c.project}`]
  if (c.tasks.length) {
    lines.push('', 'tasks:')
    for (const t of c.tasks) {
      lines.push(`  ${t.n}. [${human(t.status)}] ${t.title} · ${t.kind === 'review' ? `review by ${t.reviewer}` : `${t.agent}${t.reviewer && t.reviewer !== t.agent ? `, reviewed by ${t.reviewer}` : ''}`}${t.attempts > 1 ? ` · attempt ${t.attempts}` : ''}${t.seconds !== null ? ` · ${formatDuration(t.seconds * 1000)}${t.finishedAt ? '' : ' so far'}` : ''}${t.produces ? ` → ${t.produces}` : ''}`)
      if (t.tries && t.tries.includes(',')) lines.push(`     tries: ${t.tries}`)
      for (const f of t.findings.slice(0, 3)) lines.push(`     - ${f}`)
    }
  }
  if (c.fixes.length) {
    lines.push('', 'fixes (troupe collab fix <run> <n>):')
    for (const f of c.fixes) lines.push(`  ${f.n}. ${f.label}${f.recommended ? ' (recommended)' : ''}${f.changesGoal ? ' (changes the goal — ask the user)' : ''}${f.needsYou ? ` — you first: ${f.needsYou}` : ''}`)
  }
  if (c.status === 'awaiting_confirmation') lines.push('', 'Plan ready. Approve: troupe collab approve <run> · Reject: troupe collab reject <run>')
  if (c.wrapUp) lines.push('', 'wrap-up:', c.wrapUp.trim())
  else if (c.summary) lines.push('', c.summary)
  return lines.join('\n')
}

export interface CliSearchHit { chat: string; project: string; title: string; snippet: string }
export function searchText(hs: CliSearchHit[]): string {
  if (!hs.length) return 'Nothing found.'
  return hs.map((h) => `${h.chat}  ${h.project} · ${h.title}\n  ${h.snippet.replace(/\s+/g, ' ').trim()}`).join('\n')
}
