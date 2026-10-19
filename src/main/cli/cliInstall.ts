import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Installing the `troupe` command (D-117): a two-line wrapper in a bin folder that runs the
// script shipped inside the app, so updating Troupe updates the command too. Pure apart from
// the file system; the caller passes where the bundled script lives and the login PATH.

export const WRAPPER_MARK = '# troupe-cli-wrapper'

export function wrapperFor(script: string): string {
  return `#!/bin/bash\n${WRAPPER_MARK} — installed by Troupe (Settings ▸ Tools ▸ Command line)\nexec /bin/bash ${JSON.stringify(script)} "$@"\n`
}

const writable = (dir: string): boolean => { try { accessSync(dir, constants.W_OK); return true } catch { return false } }

/** First bin folder we may write to: Homebrew's, /usr/local/bin, else ~/.local/bin (created). */
function pickBinDir(candidates = ['/opt/homebrew/bin', '/usr/local/bin'], home = homedir()): string {
  for (const d of candidates) if (existsSync(d) && writable(d)) return d
  const local = join(home, '.local', 'bin'); mkdirSync(local, { recursive: true }); return local
}

export interface InstallResult { path: string; onPath: boolean }

export function installCommand(script: string, loginPath: string, dir = pickBinDir()): InstallResult {
  const target = join(dir, 'troupe')
  if (existsSync(target) && !readFileSync(target, 'utf8').includes(WRAPPER_MARK)) {
    throw new Error(`${target} already exists and wasn't installed by Troupe. Remove it first.`)
  }
  writeFileSync(target, wrapperFor(script), { mode: 0o755 })
  return { path: target, onPath: loginPath.split(':').includes(dir) }
}
