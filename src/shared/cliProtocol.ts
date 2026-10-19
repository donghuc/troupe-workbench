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
export interface CliStatus { run: string; chat: string; state: 'running' | 'done' | 'error' | 'stopped'; replies: CliMessage[]; partial: { agent: string; text: string }[]; error: string | null }

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
  return `${head}${s.error ? `\nerror: ${s.error}` : ''}${body}`
}
