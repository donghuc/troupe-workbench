import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { appendCapped } from '../util/limits'
import { buildEnv } from './env'
import type { AgentEvent } from '../../shared/agent'
import { stripAnsi } from '../../shared/customAgents'

// D-096: the process plumbing every agent CLI shares — spawn, write the prompt to stdin
// and close it, read stdout as JSON lines, keep a capped stderr, turn the exit into an
// error when needed, and stop the process on cancel. A provider keeps only its argument
// building and its line → AgentEvent mapping. No electron imports: tested directly.

type Push = (ev: AgentEvent) => void

export interface JsonlSpec {
  bin: string
  args: string[]
  cwd?: string
  /** Written to stdin, which is then closed (CLIs block until EOF). Omitted = closed empty. */
  stdin?: string
  /** Name in error messages; defaults to `bin`. */
  label?: string
  /** One parsed JSON line. Blank and non-JSON lines never reach it; a throw is reported to onMapError. */
  onJson: (e: any, push: Push) => void   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Every non-blank stdout line before parsing (debug trails). */
  onRaw?: (line: string) => void
  /** The process exited. Default: a non-zero code is a fatal error carrying stderr. */
  onClose?: (code: number | null, stderr: string, push: Push) => void
  onMapError?: (err: unknown) => void
  /** Overridable for tests. */
  env?: NodeJS.ProcessEnv
}

export interface TextSpec {
  bin: string
  args: string[]
  cwd?: string
  stdin?: string
  label?: string
  /** Stop the process after this long (Test runs). */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export interface ExecResult { code: number | null; stdout: string; stderr: string }

const KILL_GRACE_MS = 1500

export class CliProcess {
  private child: ChildProcessWithoutNullStreams | null = null

  get running(): boolean { return !!this.child }

  /** Stream AgentEvents from a JSON-lines CLI until it exits. */
  async *jsonl(spec: JsonlSpec): AsyncGenerator<AgentEvent> {
    const label = spec.label ?? spec.bin
    const queue: AgentEvent[] = []
    let done = false
    let notify: (() => void) | null = null
    const push: Push = (ev) => { queue.push(ev); const n = notify; notify = null; n?.() }
    const finish = () => { done = true; const n = notify; notify = null; n?.() }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(spec.bin, spec.args, { cwd: spec.cwd, env: spec.env ?? buildEnv() })
    } catch (err) {
      yield { type: 'error', message: `Failed to start ${label}: ${(err as Error).message}`, fatal: true }
      return
    }
    this.child = child
    child.stdin.on('error', () => { /* EPIPE if the CLI exits before reading; surfaced via close/stderr */ })
    child.stdin.end(spec.stdin ?? '')

    createInterface({ input: child.stdout }).on('line', (line) => {
      const t = line.trim()
      if (!t) return
      spec.onRaw?.(t)
      let e: unknown
      try { e = JSON.parse(t) } catch { return }
      try { spec.onJson(e, push) } catch (err) { spec.onMapError?.(err) }
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr = appendCapped(stderr, String(d)) })
    let started = true
    child.on('error', (err) => { started = false; push({ type: 'error', message: `Failed to start ${label}: ${err.message}`, fatal: true }); finish() })
    child.on('close', (code) => {
      if (started) {
        if (spec.onClose) spec.onClose(code, stderr, push)
        else if (code && code !== 0) push({ type: 'error', message: stderr.trim() || `${label} exited with code ${code}`, fatal: true })
      }
      finish()
    })

    try {
      while (true) {
        while (queue.length) yield queue.shift()!
        if (done) break
        await new Promise<void>((r) => { notify = r })
      }
      while (queue.length) yield queue.shift()!
    } finally {
      if (this.child === child) this.child = null
    }
  }

  /**
   * Stream a plain-text CLI (user-added agents, 2.4): every stdout chunk, colour codes
   * removed, is a text_delta; exit 0 completes; anything else is an error carrying the most
   * useful stderr line.
   */
  async *text(spec: TextSpec): AsyncGenerator<AgentEvent> {
    const label = spec.label ?? spec.bin
    const queue: AgentEvent[] = []
    let done = false
    let notify: (() => void) | null = null
    const push: Push = (ev) => { queue.push(ev); const n = notify; notify = null; n?.() }
    const finish = () => { done = true; const n = notify; notify = null; n?.() }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(spec.bin, spec.args, { cwd: spec.cwd, env: spec.env ?? buildEnv() })
    } catch (err) {
      yield { type: 'error', message: `Failed to start ${label}: ${(err as Error).message}`, fatal: true }
      return
    }
    this.child = child
    child.stdin.on('error', () => { /* EPIPE */ })
    child.stdin.end(spec.stdin ?? '')
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => { const t = stripAnsi(d); if (t) push({ type: 'text_delta', text: t }) })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr = appendCapped(stderr, String(d)) })
    let timedOut = false
    const timer = spec.timeoutMs ? setTimeout(() => { timedOut = true; this.cancel() }, spec.timeoutMs) : null
    let started = true
    child.on('error', (err) => {
      started = false
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      push({ type: 'error', message: missing ? `${label} not found. Check it's installed and the command is right.` : `Failed to start ${label}: ${err.message}`, fatal: true })
      finish()
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (started) {
        if (timedOut) push({ type: 'error', message: `${label} didn't finish within ${Math.round(spec.timeoutMs! / 1000)} seconds.`, fatal: true })
        else if (code === 0) push({ type: 'complete', usage: {} })
        else push({ type: 'error', message: stderrLine(stderr) || `${label} exited with code ${code ?? 'unknown'}`, fatal: true })
      }
      finish()
    })

    try {
      while (true) {
        while (queue.length) yield queue.shift()!
        if (done) break
        await new Promise<void>((r) => { notify = r })
      }
      while (queue.length) yield queue.shift()!
    } finally {
      if (timer) clearTimeout(timer)
      if (this.child === child) this.child = null
    }
  }

  /** Run a CLI to completion and collect its output (non-streaming CLIs, e.g. grok). */
  exec(bin: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<ExecResult> {
    return new Promise((resolve) => {
      let settled = false
      let child: ChildProcessWithoutNullStreams | null = null
      const finish = (r: ExecResult) => {
        if (settled) return
        settled = true
        if (child && this.child === child) this.child = null
        resolve(r)
      }
      try {
        child = spawn(bin, args, { cwd, env: env ?? buildEnv() })
      } catch (e) {
        finish({ code: -1, stdout: '', stderr: `Failed to start ${bin}: ${String(e)}` })
        return
      }
      this.child = child
      child.stdin.on('error', () => { /* EPIPE */ })
      child.stdin.end()
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += String(d) })
      child.stderr.on('data', (d) => { stderr = appendCapped(stderr, String(d)) })
      child.on('error', (err) => finish({ code: -1, stdout, stderr: `${stderr}\nFailed to start ${bin}: ${err.message}`.trim() }))
      child.on('close', (code) => finish({ code, stdout, stderr }))
    })
  }

  /** SIGTERM, then SIGKILL if the process is still alive after a grace period. */
  cancel(): void {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    // `killed` only means a signal was sent; check whether the process actually exited.
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, KILL_GRACE_MS).unref?.()
  }
}

/** The stderr line worth showing: the last one that reads like an error, else the last one. */
export function stderrLine(stderr: string): string {
  const lines = stripAnsi(stderr).split('\n').map((l) => l.trim()).filter(Boolean)
  // A JSON fragment such as `"message": "Unexpected server error",` reads as its value.
  const tidy = (l: string) => (l.replace(/^[•*·-]\s+/, '').match(/^"?(?:message|error)"?\s*:\s*"(.*?)"\s*,?$/i)?.[1] ?? l).replace(/^Error:\s*/i, '').slice(0, 400)
  for (let i = lines.length - 1; i >= 0; i--) if (/error|fail|denied|not found|unauthor|invalid|login|sign in|api key|quota|limit/i.test(lines[i])) return tidy(lines[i])
  return tidy(lines[lines.length - 1] ?? '')
}

/**
 * Media files under `dirs` modified after `sinceMs`, newest first. `nested` also looks one
 * level into subfolders (Codex writes generated_images/<uuid>/exec-*.png).
 */
export async function mediaFilesSince(dirs: string[], sinceMs: number, ext: RegExp, nested = false): Promise<string[]> {
  const found: { f: string; m: number }[] = []
  const seen = new Set<string>()
  const consider = async (f: string) => {
    if (seen.has(f) || !ext.test(f)) return
    seen.add(f)
    try { const s = await fsp.stat(f); if (s.isFile() && s.mtimeMs > sinceMs) found.push({ f, m: s.mtimeMs }) } catch { /* gone */ }
  }
  for (const dir of dirs) {
    let names: string[]
    try { names = await fsp.readdir(dir) } catch { continue }
    for (const name of names) {
      const p = join(dir, name)
      if (nested) {
        try {
          if ((await fsp.stat(p)).isDirectory()) { for (const f of await fsp.readdir(p)) await consider(join(p, f)); continue }
        } catch { continue }
      }
      await consider(p)
    }
  }
  return found.sort((a, b) => b.m - a.m).map((x) => x.f)
}
