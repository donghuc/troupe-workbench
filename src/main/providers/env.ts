import { homedir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

// A Finder-launched macOS app inherits a minimal PATH (no shell rc is sourced),
// so CLIs installed via a version manager (nvm/fnm/volta) or Homebrew go missing
// even though `npm run dev` (launched from a terminal) finds them. Read the real
// login-shell PATH once and merge it in. Best-effort, cached.
let loginPath: string | null | undefined // undefined = not tried, null = failed/none

function resolveLoginPath(): string | null {
  if (loginPath !== undefined) return loginPath
  loginPath = null
  if (process.platform !== 'darwin') return loginPath
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore']
    })
    // Take the last line that looks like a PATH (skip any shell-startup noise).
    const cand = out.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => l.includes('/'))
    if (cand) loginPath = cand
  } catch { /* best-effort — fall back to the static list below */ }
  return loginPath
}

/** Forget the cached login-shell PATH, so a CLI installed while the app runs is found on the next check (D-103 Re-check). */
export function resetLoginPath(): void { loginPath = undefined }

// Common CLI install locations, so Finder-launched apps (minimal PATH) still find binaries.
export function buildEnv(): NodeJS.ProcessEnv {
  const extra = [
    '/opt/homebrew/bin', '/usr/local/bin',
    join(homedir(), '.local/bin'), join(homedir(), '.claude/local'),
    join(homedir(), '.npm-global/bin'), join(homedir(), '.volta/bin'),
    join(homedir(), '.cargo/bin'), join(homedir(), '.bun/bin'),
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
