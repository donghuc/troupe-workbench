// Starting and stopping agent CLIs (Windows port, D-120). On macOS every function here is a
// plain pass-through to child_process — the Mac code path is unchanged. On Windows the
// program is resolved through PATH/PATHEXT and npm shims (winBin.ts), every child is started
// with windowsHide (no console window flashing up), and stopping ends the whole tree.
import { spawn, execFile, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio, type ExecFileOptions } from 'child_process'
import { readFileSync, statSync } from 'fs'
import { winLaunch, cmdArgs, findWinBin, type WinFs } from './winBin'

const isWin = process.platform === 'win32'

const realFs: WinFs = {
  exists: (p) => { try { return statSync(p).isFile() } catch { return false } },
  read: (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
}

interface Prepared<O> { file: string; args: string[]; opts: O }

function prepare<O extends { env?: NodeJS.ProcessEnv }>(bin: string, args: string[], opts: O): Prepared<O & { windowsHide: true }> {
  const base = { ...opts, windowsHide: true as const }
  const env = opts.env ?? process.env
  const l = winLaunch(bin, env, realFs, process.execPath)
  if (!l) return { file: bin, args, opts: base }   // not on PATH: spawn reports ENOENT as before
  if (l.batch) return { file: l.file, args: cmdArgs(l.batch, args), opts: { ...base, windowsVerbatimArguments: true } }
  return { file: l.file, args: [...l.prefix, ...args], opts: l.runAsNode ? { ...base, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } } : base }
}

/** spawn() for an agent CLI with piped stdio. */
export function spawnCli(bin: string, args: string[], opts: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
  if (!isWin) return spawn(bin, args, opts)
  const p = prepare(bin, args, opts)
  return spawn(p.file, p.args, p.opts)
}

/** execFile() for an agent CLI (version / status probes). */
export function execFileCli(
  bin: string, args: string[], opts: ExecFileOptions,
  cb: (err: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void
): ChildProcess {
  const done = (e: Error | null, out: string | Buffer, err: string | Buffer) => cb(e, String(out ?? ''), String(err ?? ''))
  if (!isWin) return execFile(bin, args, opts, done)
  const p = prepare(bin, args, opts)
  return execFile(p.file, p.args, p.opts, done)
}

/**
 * Stop a child. macOS: the signal, as before. Windows has no signals or process groups:
 * `taskkill /T /F` ends the child and everything it started (node, ripgrep, MCP servers),
 * which would otherwise keep running and keep files in the project open.
 */
export function stopChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!isWin || !child.pid) { child.kill(signal); return }
  execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { /* already gone */ })
}

/** Windows: full path of `bin` on the env's PATH (PATHEXT applied), or null. */
export function whichWin(bin: string, env: NodeJS.ProcessEnv): string | null {
  return findWinBin(bin, env, realFs)
}
