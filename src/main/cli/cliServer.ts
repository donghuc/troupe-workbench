import { createServer, type Server, type IncomingMessage } from 'http'
import { timingSafeEqual } from 'crypto'
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'fs'
import { runCliCommand } from './cliCommands'
import { logInfo, logError } from '../util/logger'

// Command-line access (D-117). The `troupe` command talks to the running app over a Unix
// socket in the app's own folder, readable only by this macOS user (0600). There is no TCP
// port: nothing on the network — and no web page — can reach it. Off unless the user turns
// on Settings ▸ Tools ▸ Command line. Every request is one command; the app does the work.
//
// Windows (D-120): a named pipe instead. Node creates pipes with Windows' default ACL, which
// lets every local account read them and can't be narrowed like 0600 (nodejs/node#47086), so
// there each request must also carry a random per-launch token that only this user can read
// (written to the app's folder by cliAccess.ts).

const MAX_BODY = 1_000_000
let server: Server | null = null
let current: string | null = null
// Windows token (D-120). Module-level so a refresh with a new token applies to the open
// server too — the first PC test got "not allowed" after Settings ▸ Save re-ran refresh,
// which wrote a new token file while the server still expected the old one.
let token: string | undefined

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const tokenOk = (got: unknown, want: string): boolean => {
  if (typeof got !== 'string') return false
  const a = Buffer.from(got), b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Open the socket (or, with `pipe`, the Windows named pipe) at `socketPath` (no-op if already open there). */
export function startCliServer(socketPath: string, opts: { pipe?: boolean; token?: string } = {}): Promise<void> {
  token = opts.token
  if (server && current === socketPath) return Promise.resolve()
  stopCliServer()
  // A socket left by a crash blocks listen(); remove it only if it really is a socket.
  if (!opts.pipe) try { if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath) } catch { /* listen reports it */ }
  const s = createServer(async (req, res) => {
    if (token && !tokenOk(req.headers['x-troupe-token'], token)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end("error: not allowed — this troupe command doesn't have Troupe's current key. In Troupe, open Settings ▸ Tools ▸ Command line and click Reinstall.\n"); return }
    let closed = false
    res.on('close', () => { closed = true })
    // D-121: every request is logged with how late it arrived (the script sends its own clock)
    // and how long it took — a `collab stop` that hung for minutes left no trace.
    let lastDo: string | null = null
    const t0 = Date.now()
    const sent = Number(req.headers['x-troupe-sent'])
    const lagMs = Number.isFinite(sent) && sent > 0 ? t0 - sent * 1000 : null
    res.on('finish', () => logInfo('[cli] request', { path: req.url, do: lastDo, status: res.statusCode, ms: Date.now() - t0, ...(lagMs !== null && lagMs > 2000 ? { arrivedLateMs: lagMs } : {}) }))
    try {
      const url = new URL(req.url ?? '/', 'http://troupe')
      const m = /^\/v1\/([a-z]+)$/.exec(url.pathname)
      if (!m || req.method !== 'POST') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('error: not found\n'); return }
      const body = await readBody(req)
      const q = new URLSearchParams(body)
      for (const [k, v] of url.searchParams) if (!q.has(k)) q.set(k, v)
      lastDo = q.get('do')
      const r = await runCliCommand(m[1], q, () => closed)
      if (closed) return
      const json = q.get('format') === 'json'
      res.writeHead(r.status, { 'content-type': json ? 'application/json' : 'text/plain; charset=utf-8' })
      res.end(json ? JSON.stringify(r.json) + '\n' : r.text + '\n')
    } catch (e) {
      if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' })
      res.end(`error: ${e instanceof Error ? e.message : String(e)}\n`)
    }
  })
  // `status --wait` holds a request open for up to 15 minutes.
  s.requestTimeout = 0; s.timeout = 0; s.keepAliveTimeout = 5000
  return new Promise((resolve, reject) => {
    s.once('error', (e) => { logError('[cli] socket failed', String(e)); server = null; current = null; reject(e) })
    s.listen(socketPath, () => {
      if (!opts.pipe) try { chmodSync(socketPath, 0o600) } catch (e) { logError('[cli] chmod failed', String(e)); s.close(); reject(e); return }
      server = s; current = socketPath
      logInfo('[cli] listening', { socket: socketPath })
      resolve()
    })
  })
}

export function stopCliServer(): void {
  if (!server) return
  const p = current
  server.close(); server.closeAllConnections(); server = null; current = null; token = undefined
  try { if (p && !p.startsWith('\\\\.\\pipe\\') && existsSync(p)) unlinkSync(p) } catch { /* best-effort */ }
  logInfo('[cli] closed')
}

export const cliServerOpen = (): boolean => !!server
