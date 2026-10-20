// Runs one setup command (install or sign-in) in the background: the user's login shell
// with Troupe's merged PATH (finds nvm/Homebrew set up in .zshrc), no TTY, its own process
// group so Cancel and the timeout stop everything it started. Electron-free: tested with
// fake installer scripts.
import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { cleanLine, lastErrorLine, powershellArgs, powershellExe } from './setupRules'
import { stopChild } from '../platform/proc'

export interface SetupResult { ok: boolean; code: number | null; timedOut: boolean; cancelled: boolean; error?: string }

export interface SetupHandle { cancel: () => void; done: Promise<SetupResult> }

export function runSetupCommand(cmd: string, opts: { env: NodeJS.ProcessEnv; timeoutMs: number; onLine: (line: string) => void; shell?: string }): SetupHandle {
  const shell = opts.shell ?? (process.env.SHELL || '/bin/zsh')
  const env = { ...opts.env, NO_COLOR: '1', TERM: 'dumb' }
  const lines: string[] = []
  let timedOut = false
  let cancelled = false
  const win = process.platform === 'win32'
  // Windows (D-120): PowerShell, hidden; there are no process groups, so stopping ends the tree.
  const child = win
    ? spawn(powershellExe(), powershellArgs(cmd), { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(shell, ['-lc', cmd], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const killGroup = () => {
    if (win) { stopChild(child); return }
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
    setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, 1500).unref()
  }
  const take = (raw: string) => {
    const l = cleanLine(raw)
    if (!l) return
    lines.push(l); if (lines.length > 200) lines.shift()
    opts.onLine(l)
  }
  createInterface({ input: child.stdout }).on('line', take)
  createInterface({ input: child.stderr }).on('line', take)
  const timer = setTimeout(() => { timedOut = true; killGroup() }, opts.timeoutMs)
  const done = new Promise<SetupResult>((resolve) => {
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, code: null, timedOut, cancelled, error: err.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const ok = code === 0 && !timedOut && !cancelled
      resolve({
        ok, code, timedOut, cancelled,
        ...(ok ? {} : { error: timedOut ? 'It took too long and was stopped.' : cancelled ? 'Cancelled.' : lastErrorLine(lines) })
      })
    })
  })
  return { cancel: () => { cancelled = true; killGroup() }, done }
}
