import { createServer, type Server, type IncomingMessage } from 'http'
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'fs'
import { runCliCommand } from './cliCommands'
import { logInfo, logError } from '../util/logger'

// Command-line access (D-117). The `troupe` command talks to the running app over a Unix
// socket in the app's own folder, readable only by this macOS user (0600). There is no TCP
// port: nothing on the network — and no web page — can reach it. Off unless the user turns
// on Settings ▸ Tools ▸ Command line. Every request is one command; the app does the work.

const MAX_BODY = 1_000_000
let server: Server | null = null
let current: string | null = null

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Open the socket at `socketPath` (no-op if already open there). */
export function startCliServer(socketPath: string): Promise<void> {
  if (server && current === socketPath) return Promise.resolve()
  stopCliServer()
  // A socket left by a crash blocks listen(); remove it only if it really is a socket.
  try { if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath) } catch { /* listen reports it */ }
  const s = createServer(async (req, res) => {
    let closed = false
    res.on('close', () => { closed = true })
    try {
      const url = new URL(req.url ?? '/', 'http://troupe')
      const m = /^\/v1\/([a-z]+)$/.exec(url.pathname)
      if (!m || req.method !== 'POST') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('error: not found\n'); return }
      const body = await readBody(req)
      const q = new URLSearchParams(body)
      for (const [k, v] of url.searchParams) if (!q.has(k)) q.set(k, v)
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
      try { chmodSync(socketPath, 0o600) } catch (e) { logError('[cli] chmod failed', String(e)); s.close(); reject(e); return }
      server = s; current = socketPath
      logInfo('[cli] listening', { socket: socketPath })
      resolve()
    })
  })
}

export function stopCliServer(): void {
  if (!server) return
  const p = current
  server.close(); server.closeAllConnections(); server = null; current = null
  try { if (p && existsSync(p)) unlinkSync(p) } catch { /* best-effort */ }
  logInfo('[cli] closed')
}

export const cliServerOpen = (): boolean => !!server
