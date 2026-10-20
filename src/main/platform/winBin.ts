// Windows: find an agent CLI and work out how to start it without a shell (Windows port,
// D-120). Pure apart from the injected `exists` / `read`, so it is tested on any OS.
//
// Why: on Windows `claude` / `codex` are `claude.exe` or npm's `codex.cmd` shims. Node's
// spawn() doesn't apply PATHEXT, and since CVE-2024-27980 it refuses `.cmd`/`.bat` without
// `shell: true` (EINVAL). A shell would re-open argument injection, so an npm shim is
// resolved to the script it wraps and run with node; only an unrecognised batch file falls
// back to cmd.exe, with every argument escaped the way cross-spawn does it.
import { win32 as wpath } from 'path'

export interface WinLaunch {
  /** The program to spawn (an .exe). */
  file: string
  /** Arguments to put before the caller's arguments (e.g. the script for node). */
  prefix: string[]
  /** Set when `file` is cmd.exe: the batch file to run through it (see cmdArgs). */
  batch?: string
  /** Set ELECTRON_RUN_AS_NODE=1: `file` is Troupe's own executable acting as node. */
  runAsNode?: boolean
}

export interface WinFs {
  exists: (p: string) => boolean
  read: (p: string) => string | null
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** The value of PATH in an env object, whatever its case ("Path" on Windows). */
export function envPath(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH')
  return (key && env[key]) || ''
}

/** Full path of `bin` on PATH, trying PATHEXT extensions; absolute paths are checked as given. */
export function findWinBin(bin: string, env: NodeJS.ProcessEnv, fs: WinFs): string | null {
  const exts = (env.PATHEXT || DEFAULT_PATHEXT).split(';').map((e) => e.trim().toLowerCase()).filter(Boolean)
  const hasExt = !!wpath.extname(bin) && exts.includes(wpath.extname(bin).toLowerCase())
  const names = hasExt ? [bin] : exts.map((e) => bin + e)
  if (/[\\/]/.test(bin)) {
    if (!wpath.isAbsolute(bin)) return null
    return names.find((n) => fs.exists(n)) ?? null
  }
  for (const dir of envPath(env).split(';')) {
    const d = dir.trim().replace(/^"(.*)"$/, '$1')
    if (!d) continue
    for (const n of names) {
      const full = wpath.join(d, n)
      if (fs.exists(full)) return full
    }
  }
  return null
}

/**
 * The target of an npm/cmd-shim `.cmd`: the last `"%dp0%\…"` before `%*`.
 * Returns the absolute path, or null when the file isn't a shim we recognise.
 */
export function shimTarget(cmdPath: string, text: string): string | null {
  const re = /"%~?dp0%?\\([^"]+)"\s+%\*/gi
  let m: RegExpExecArray | null
  let last: string | null = null
  while ((m = re.exec(text))) last = m[1]
  if (!last) return null
  return wpath.join(wpath.dirname(cmdPath), last)
}

// cmd.exe metacharacters (cross-spawn's list).
const META = /([()\][%!^"`<>&|;, *?])/g

/** Quote one argument for `cmd.exe /d /s /c "…"` (cross-spawn's escapeArgument). */
export function escapeCmdArg(arg: string, doubleEscape: boolean): string {
  let a = `${arg}`
  a = a.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')   // backslashes before a quote double, the quote is escaped
  a = a.replace(/(?=(\\+?)?)\1$/, '$1$1')       // trailing backslashes double (they precede our closing quote)
  a = `"${a}"`
  a = a.replace(META, '^$1')
  if (doubleEscape) a = a.replace(META, '^$1')
  return a
}

/** How to launch `bin` on Windows, or null when it isn't on PATH. */
export function winLaunch(bin: string, env: NodeJS.ProcessEnv, fs: WinFs, nodeFallback: string): WinLaunch | null {
  const found = findWinBin(bin, env, fs)
  if (!found) return null
  const ext = wpath.extname(found).toLowerCase()
  if (ext !== '.cmd' && ext !== '.bat') return { file: found, prefix: [] }
  const target = shimTarget(found, fs.read(found) ?? '')
  if (target && fs.exists(target)) {
    const t = wpath.extname(target).toLowerCase()
    if (t === '.exe') return { file: target, prefix: [] }
    if (t === '.js' || t === '.cjs' || t === '.mjs' || t === '') {
      // npm puts node.exe next to the shim when it was installed with a bundled node.
      const local = wpath.join(wpath.dirname(found), 'node.exe')
      const node = fs.exists(local) ? local : findWinBin('node', env, fs)
      return node ? { file: node, prefix: [target] } : { file: nodeFallback, prefix: [target], runAsNode: true }
    }
  }
  return { file: env.ComSpec || env.COMSPEC || 'cmd.exe', prefix: [], batch: found }
}

/** Arguments for cmd.exe when `winLaunch` returned a batch file: `/d /s /c "<escaped command line>"`. */
export function cmdArgs(batchFile: string, args: string[]): string[] {
  const shim = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(batchFile)
  const line = [batchFile.replace(META, '^$1'), ...args.map((a) => escapeCmdArg(a, shim))].join(' ')
  return ['/d', '/s', '/c', `"${line}"`]
}
