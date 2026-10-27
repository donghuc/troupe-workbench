import { app, powerSaveBlocker } from 'electron'
import { join } from 'path'
import { getSetting } from '../database/settingsRepo'
import { startCliServer, stopCliServer, cliServerOpen } from './cliServer'
import { installCommand, installCommandWin, winWrapperFor, winScriptFor, WRAPPER_MARK, type InstallResult } from './cliInstall'
import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'
import { userInfo } from 'os'
import { buildEnv, resetLoginPath } from '../providers/env'
import { powershellExe } from '../agents/setupRules'
import { CLI_ACCESS_SETTING, CLI_SOCKET_NAME } from '../../shared/cliProtocol'
import { logError } from '../util/logger'

// Electron side of command-line access (D-117): where the socket and script live, and
// opening/closing the socket when the setting changes.

const isWin = process.platform === 'win32'
// D-120: on Windows a named pipe; the token file sits in the app's folder.
// Audit 2026-10-26: the name was `troupe-<user name>` — guessable, so another account on the PC
// could create it first and receive the token. It now ends in a random id kept next to the token
// (%APPDATA% is readable only by this user); troupe.cmd is rewritten with it when access opens.
let pipeIdCache: string | null = null
function pipeId(): string {
  if (pipeIdCache) return pipeIdCache
  const f = join(app.getPath('userData'), 'cli-pipe-id')
  try { const v = readFileSync(f, 'utf8').trim(); if (/^[a-f0-9]{16}$/.test(v)) return (pipeIdCache = v) } catch { /* first use */ }
  const v = randomBytes(8).toString('hex')
  writeFileSync(f, v, { mode: 0o600 })
  return (pipeIdCache = v)
}
const winPipe = (): string => `\\\\.\\pipe\\troupe-${(userInfo().username || 'user').replace(/[^A-Za-z0-9_.-]/g, '_')}-${pipeId()}`
const tokenFile = (): string => join(app.getPath('userData'), 'cli-token')
const cliSocketPath = (): string => isWin ? winPipe() : join(app.getPath('userData'), CLI_SOCKET_NAME)
const resourcePath = (name: string): string => app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
const cliScriptPath = (): string => resourcePath(isWin ? 'troupe-cli.mjs' : 'troupe')

// D-121: while command-line access is on, keep macOS App Nap from suspending Troupe in the
// background — a bot's command to a napping app can wait minutes for an answer.
let blocker: number | null = null
function keepAwake(on: boolean): void {
  if (on && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  else if (!on && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null }
}

/** Open or close the socket to match the setting. Safe to call any time. */
export async function refreshCliAccess(): Promise<void> {
  if (getSetting(CLI_ACCESS_SETTING) === '1') {
    try {
      if (isWin) {
        const token = randomBytes(32).toString('hex')
        writeFileSync(tokenFile(), token, { mode: 0o600 })   // %APPDATA% is readable only by this user
        await startCliServer(cliSocketPath(), { pipe: true, token })
        refreshInstalledWin()
      } else await startCliServer(cliSocketPath())
      keepAwake(true)
    } catch (e) { logError('[cli] could not open the socket', String(e)) }
  } else {
    stopCliServer()
    keepAwake(false)
    if (isWin) try { unlinkSync(tokenFile()) } catch { /* not there */ }
  }
}

export function cliStatus(): { enabled: boolean; open: boolean; socket: string } {
  return { enabled: getSetting(CLI_ACCESS_SETTING) === '1', open: cliServerOpen(), socket: cliSocketPath() }
}

export function installCli(): InstallResult {
  if (isWin) return installCliWin()
  return installCommand(cliScriptPath(), buildEnv().PATH ?? '')
}

const winBinDir = (): string => join(process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local'), 'Troupe', 'bin')

/** An app update can change the wrapper (2.11.1: arguments no longer go through PowerShell);
 *  rewrite an installed copy of ours so nobody has to click Reinstall. Never touches PATH. */
function refreshInstalledWin(): void {
  try {
    const cmd = join(winBinDir(), 'troupe.cmd')
    if (!existsSync(cmd)) return
    const cur = readFileSync(cmd, 'utf8')
    if (!cur.includes(WRAPPER_MARK)) return
    const ps1 = join(winBinDir(), 'troupe-run.ps1')
    const ps1Now = existsSync(ps1) ? readFileSync(ps1, 'utf8') : ''
    if (cur === winWrapperFor() && ps1Now === '\ufeff' + winScriptFor(process.execPath, cliScriptPath(), cliSocketPath(), tokenFile())) return
    installCommandWin(process.execPath, cliScriptPath(), cliSocketPath(), tokenFile(), winBinDir(), '')
  } catch (e) { logError('[cli] could not update troupe.cmd', String(e)) }
}

/** Windows: write troupe.cmd to %LOCALAPPDATA%\\Troupe\\bin and put that folder on the user PATH. */
function installCliWin(): InstallResult {
  const dir = winBinDir()
  const r = installCommandWin(process.execPath, cliScriptPath(), cliSocketPath(), tokenFile(), dir, '')
  // [Environment]::SetEnvironmentVariable updates the registry and tells Windows, so new
  // terminals see it. The folder goes in through an env var, never into the script text.
  try {
    execFileSync(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command',
      "$d=$env:TROUPE_BIN; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains $d)) { [Environment]::SetEnvironmentVariable('Path', ($(if ($p) { $p.TrimEnd(';') + ';' } else { '' }) + $d), 'User') }"],
      { env: { ...process.env, TROUPE_BIN: dir }, windowsHide: true, timeout: 20000, stdio: 'ignore' })
    resetLoginPath()
    return { path: r.path, onPath: true }
  } catch (e) {
    logError('[cli] could not add the folder to PATH', String(e))
    return r
  }
}

export { stopCliServer }

/** CI smoke test only (platform/smoke.ts): open the CLI server regardless of the setting. */
export async function forceCliForSmoke(): Promise<{ pipe: string; tokenFile?: string; installed?: string }> {
  if (isWin) {
    const token = randomBytes(32).toString('hex')
    writeFileSync(tokenFile(), token, { mode: 0o600 })
    await startCliServer(cliSocketPath(), { pipe: true, token })
    return { pipe: cliSocketPath(), tokenFile: tokenFile(), installed: installCliWin().path }
  }
  await startCliServer(cliSocketPath())
  return { pipe: cliSocketPath() }
}
