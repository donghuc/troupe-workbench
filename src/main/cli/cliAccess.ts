import { app } from 'electron'
import { join } from 'path'
import { getSetting } from '../database/settingsRepo'
import { startCliServer, stopCliServer, cliServerOpen } from './cliServer'
import { installCommand, type InstallResult } from './cliInstall'
import { buildEnv } from '../providers/env'
import { CLI_ACCESS_SETTING, CLI_SOCKET_NAME } from '../../shared/cliProtocol'
import { logError } from '../util/logger'

// Electron side of command-line access (D-117): where the socket and script live, and
// opening/closing the socket when the setting changes.

const cliSocketPath = (): string => join(app.getPath('userData'), CLI_SOCKET_NAME)
const cliScriptPath = (): string => app.isPackaged ? join(process.resourcesPath, 'troupe') : join(app.getAppPath(), 'resources', 'troupe')

/** Open or close the socket to match the setting. Safe to call any time. */
export async function refreshCliAccess(): Promise<void> {
  if (getSetting(CLI_ACCESS_SETTING) === '1') {
    try { await startCliServer(cliSocketPath()) } catch (e) { logError('[cli] could not open the socket', String(e)) }
  } else stopCliServer()
}

export function cliStatus(): { enabled: boolean; open: boolean; socket: string } {
  return { enabled: getSetting(CLI_ACCESS_SETTING) === '1', open: cliServerOpen(), socket: cliSocketPath() }
}

export function installCli(): InstallResult {
  return installCommand(cliScriptPath(), buildEnv().PATH ?? '')
}

export { stopCliServer }
