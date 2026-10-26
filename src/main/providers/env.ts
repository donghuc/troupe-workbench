import { homedir } from 'os'
import { join } from 'path'
import { execFileSync, execFile } from 'child_process'
import { winExtraDirs, expandWinVars, parseRegPath, joinWinPath, withWinPath } from '../platform/winEnv'
import { envPath } from '../platform/winBin'

// A Finder-launched macOS app inherits a minimal PATH (no shell rc is sourced),
// so CLIs installed via a version manager (nvm/fnm/volta) or Homebrew go missing
// even though `npm run dev` (launched from a terminal) finds them. Read the real
// login-shell PATH once and merge it in. Best-effort, cached.
let loginPath: string | null | undefined // undefined = not tried, null = failed/none

let refreshing: Promise<void> | null = null

const lastPathLine = (out: string): string | null =>
  out.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => l.includes('/')) ?? null

function resolveLoginPath(): string | null {
  if (loginPath !== undefined) return loginPath
  // Audit #5: a refresh is reading it without blocking — use the static list until it lands.
  if (refreshing) return null
  loginPath = null
  if (process.platform !== 'darwin') return loginPath
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore']
    })
    // Take the last line that looks like a PATH (skip any shell-startup noise).
    const cand = lastPathLine(out)
    if (cand) loginPath = cand
  } catch { /* best-effort — fall back to the static list below */ }
  return loginPath
}

/** Forget the cached login-shell PATH, so a CLI installed while the app runs is found on the next check (D-103 Re-check). */
export function resetLoginPath(): void { loginPath = undefined; winRegPath = undefined; if (process.platform === 'darwin') void refreshLoginPath() }

/** Re-read the login-shell PATH without blocking the main process (audit #5: the sync read
 *  froze streaming and every IPC call for up to 4 s on each agent check). Calls share one read. */
export function refreshLoginPath(): Promise<void> {
  if (refreshing) return refreshing
  if (process.platform !== 'darwin') { loginPath = undefined; winRegPath = undefined; return Promise.resolve() }
  const shell = process.env.SHELL || '/bin/zsh'
  refreshing = new Promise<void>((resolve) => {
    execFile(shell, ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 4000 }, (err, out) => {
      loginPath = !err || out ? lastPathLine(String(out ?? '')) : null
      refreshing = null
      resolve()
    })
  })
  return refreshing
}

// Windows (D-120): the user + machine PATH as the registry has them now, cached like the
// login-shell PATH above and re-read after an install (resetLoginPath).
let winRegPath: string | null | undefined

function regPath(key: string): string | null {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const v = parseRegPath(out)
    return v ? expandWinVars(v, process.env) : null
  } catch { return null }
}

function buildWinEnv(): NodeJS.ProcessEnv {
  if (winRegPath === undefined) {
    winRegPath = joinWinPath([regPath('HKCU\\Environment'), regPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')]) || null
  }
  return withWinPath(process.env, joinWinPath([envPath(process.env), winRegPath, ...winExtraDirs(process.env)]))
}

// Common CLI install locations, so Finder-launched apps (minimal PATH) still find binaries.
export function buildEnv(): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return buildWinEnv()
  const extra = [
    '/opt/homebrew/bin', '/usr/local/bin',
    join(homedir(), '.local/bin'), join(homedir(), '.claude/local'),
    join(homedir(), '.npm-global/bin'), join(homedir(), '.volta/bin'),
    join(homedir(), '.cargo/bin'), join(homedir(), '.bun/bin'), join(homedir(), '.opencode/bin'),
    '/usr/local/share/npm/bin'
  ]
  const parts = [process.env.PATH, resolveLoginPath(), ...extra].filter(Boolean) as string[]
  // Flatten to individual dirs and de-dupe while preserving order.
  const seen = new Set<string>()
  const path = parts
    .flatMap((p) => p.split(':'))
    .filter((d) => d && !seen.has(d) && (seen.add(d), true))
    .join(':')
  return { ...process.env, PATH: path }
}
