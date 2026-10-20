// Windows PATH for agent CLIs (Windows port, D-120) — the counterpart of the macOS
// login-shell PATH in providers/env.ts. A running app keeps the PATH it started with, so an
// agent installed from Troupe's own onboarding (which adds its folder to the user PATH in
// the registry) would stay "not found" until a restart. Re-read the user and machine PATH
// from the registry instead, and add the folders the official installers use.
import { win32 as wpath } from 'path'

/** Folders the agents' Windows installers put their binaries in. */
export function winExtraDirs(env: NodeJS.ProcessEnv): string[] {
  const up = env.USERPROFILE ?? ''
  const la = env.LOCALAPPDATA ?? (up && wpath.join(up, 'AppData', 'Local'))
  const ad = env.APPDATA ?? (up && wpath.join(up, 'AppData', 'Roaming'))
  const pf = env.ProgramFiles ?? 'C:\\Program Files'
  return [
    up && wpath.join(up, '.local', 'bin'),                          // Claude Code native installer
    la && wpath.join(la, 'Programs', 'OpenAI', 'Codex', 'bin'),    // Codex standalone installer
    la && wpath.join(la, 'Microsoft', 'WinGet', 'Links'),          // winget
    ad && wpath.join(ad, 'npm'),                                     // npm -g
    la && wpath.join(la, 'Antigravity'),                             // agy
    up && wpath.join(up, '.grok', 'bin'),
    up && wpath.join(up, '.bun', 'bin'),
    up && wpath.join(up, '.cargo', 'bin'),
    wpath.join(pf, 'nodejs'),
    wpath.join(pf, 'Git', 'cmd')
  ].filter(Boolean) as string[]
}

/** Expand %VAR% references (REG_EXPAND_SZ values) from `env`, case-insensitively. */
export function expandWinVars(s: string, env: NodeJS.ProcessEnv): string {
  const lookup = (name: string) => { const k = Object.keys(env).find((x) => x.toUpperCase() === name.toUpperCase()); return k ? env[k] : undefined }
  return s.replace(/%([^%;]+)%/g, (m, name: string) => lookup(name) ?? m)
}

/** The Path value from `reg query … /v Path` output, or null. */
export function parseRegPath(out: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i.exec(line)
    if (m) return m[1].trim()
  }
  return null
}

/** Join PATH pieces with `;`, dropping blanks and case-insensitive duplicates, keeping order. */
export function joinWinPath(parts: (string | null | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    for (const raw of (p ?? '').split(';')) {
      const d = raw.trim()
      const key = d.replace(/[\\/]+$/, '').toLowerCase()
      if (!d || seen.has(key)) continue
      seen.add(key)
      out.push(d)
    }
  }
  return out.join(';')
}

/** `env` with one PATH key (Windows env names are case-insensitive; a spread copy isn't). */
export function withWinPath(env: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== 'PATH') out[k] = v
  out.PATH = path
  return out
}
