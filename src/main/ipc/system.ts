import { app, shell, clipboard, nativeImage, ClipboardItem } from 'electron'
import { handle } from './handle'
import { openArtifactWindow } from '../window/artifactWindow'
import { ensureInside } from '../filesystem/fsService'
import { existsSync, copyFileSync, mkdirSync, readFileSync } from 'fs'
import { homedir, arch } from 'os'
import { dirname, basename, join, isAbsolute, resolve } from 'path'
import { listAgentTools, addMcpServer, removeMcpServer, refreshLiveMcpNames } from '../tools/toolsService'
import { logPath, logError } from '../util/logger'
import { assertProjectRoot } from '../security/roots'
import { expectString } from '../security/pathGuard'
import type { ProviderId, McpAddInput } from '../../shared/types'
import { codexAutoModels } from '../tools/codexModels'
import { refreshGeminiModels } from '../tools/geminiModels'
import { describeProviders } from '../providers/registry'
import { getSetting } from '../database/settingsRepo'
import { enabledProviderIds, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { buildDiagnostics, tailLines } from '../../shared/diagnostics'
import { cliStatus, installCli } from '../cli/cliAccess'

let commit: string | undefined
function buildCommit(): string {
  if (commit === undefined) {
    try { commit = String(JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')).troupeCommit ?? '') } catch { commit = '' }
  }
  return commit
}

export function registerSystemIpc(): void {
  // Open the native macOS Lookup/dictionary panel for the current text selection.
  handle('system.lookup', (e) => {
    try { e.sender.showDefinitionForSelection() } catch { /* non-macOS or no selection */ }
  })
  handle('system.openArtifactWindow', (_e, root: string, relPath: string) => openArtifactWindow(assertProjectRoot(root), expectString(relPath, 'path')))
  handle('system.revealItem', (_e, root: string, relPath: string) => {
    try {
      const abs = ensureInside(assertProjectRoot(root), expectString(relPath, 'path'))
      if (existsSync(abs)) shell.showItemInFolder(abs)
      else if (existsSync(dirname(abs))) shell.openPath(dirname(abs))
      return true
    } catch { return false }
  })
  // D-086: a reply linked a file outside the project folder. Reveal shows it in Finder
  // (no read); Import copies it into <root>/imported/ so the card can open it.
  handle('system.revealOutside', (_e, absPath: string) => {
    try {
      const p = resolve(expectString(absPath, 'path'))
      if (!isAbsolute(p) || !existsSync(p)) return false
      shell.showItemInFolder(p); return true
    } catch { return false }
  })
  handle('system.importOutside', (_e, root: string, absPath: string) => {
    try {
      const r = assertProjectRoot(root)
      const p = resolve(expectString(absPath, 'path'))
      if (!isAbsolute(p) || !existsSync(p)) return null
      const dir = ensureInside(r, 'imported'); mkdirSync(dir, { recursive: true })
      let name = basename(p); let dest = join(dir, name); let n = 1
      while (existsSync(dest)) { const i = name.lastIndexOf('.'); dest = join(dir, i > 0 ? `${name.slice(0, i)}-${n}${name.slice(i)}` : `${name}-${n}`); n++ }
      copyFileSync(p, dest)
      return `imported/${basename(dest)}`
    } catch { return null }
  })
  // Open a file in its default macOS app (e.g. Preview for a PDF).
  handle('system.openItem', async (_e, root: string, relPath: string) => {
    try {
      const abs = ensureInside(assertProjectRoot(root), expectString(relPath, 'path'))
      if (!existsSync(abs)) return false
      // D-120: on Windows "open" runs programs and scripts outright; refuse those (a file an
      // agent or a cloned repo put in the project shouldn't run from a click in a reply).
      if (process.platform === 'win32' && /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|cpl|lnk|reg|pif|appref-ms)$/i.test(abs)) return false
      const err = await shell.openPath(abs)
      return err === ''
    } catch { return false }
  })
  // Copy an image file's bitmap to the system clipboard (png/jpg/etc via nativeImage).
  // Electron 44 replaced clipboard.writeImage with the web-style async
  // clipboard.write([ClipboardItem]); a PNG blob is the portable payload.
  handle('system.copyImage', async (_e, root: string, relPath: string) => {
    try {
      const abs = ensureInside(assertProjectRoot(root), expectString(relPath, 'path'))
      if (!existsSync(abs)) return false
      const img = nativeImage.createFromPath(abs)
      if (img.isEmpty()) return false
      const png = new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' })
      await clipboard.write([new ClipboardItem({ 'image/png': png })])
      return true
    } catch { return false }
  })
  // Codex's own model list (D-076); the renderer merges the typed extras itself.
  // Each agent's own model list, newest first (D-076 Codex, D-079 Gemini); the renderer
  // keeps the newest few and merges the typed "More models" itself (D-078).
  handle('system.autoModels', async () => ({ codex: codexAutoModels(), gemini: await refreshGeminiModels() }))
  handle('system.appInfo', () => ({
    // D-120: CI builds (Windows) stamp the short commit into package.json (extraMetadata).
    version: app.getVersion() + (buildCommit() ? ` (${buildCommit()})` : ''),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }))
  // Copy diagnostics (D-103): versions, each agent's state, the last 200 log lines — scrubbed.
  handle('system.diagnostics', async () => {
    const providers = await describeProviders()
    const enabled = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING))
    let log = ''
    try { log = readFileSync(logPath(), 'utf8') } catch { /* no log yet */ }
    let os = `macOS ${process.getSystemVersion?.() ?? ''}`.trim()
    if (process.platform === 'win32') os = `Windows ${process.getSystemVersion?.() ?? ''}`.trim()
    else if (process.platform !== 'darwin') os = process.platform
    return buildDiagnostics({
      app: { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: arch(), os },
      agents: providers.map((p) => ({ name: p.name, installed: !!p.availability.installed, authenticated: !!p.availability.authenticated, detail: p.availability.detail, enabled: enabled.includes(p.id) })),
      logTail: tailLines(log, 200),
      home: homedir()
    })
  })
  // Reveal the app's log file (userData/logs/main.log) in Finder for bug reports.
  handle('system.openLogs', () => { try { shell.showItemInFolder(logPath()); return true } catch { return false } })
  // Renderer errors (render crashes, failed IPC calls, unhandled rejections) land
  // in main.log next to main-process errors (audit #14). Strings only, capped.
  handle('system.logRendererError', (_e, where: unknown, message: unknown, detail?: unknown) => {
    const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
    logError(`renderer: ${cap(where, 120) || 'unknown'}: ${cap(message, 1000)}`, detail ? cap(detail, 4000) : undefined)
  })
  handle('system.tools', (_e, provider: ProviderId, cwd?: string) => listAgentTools(provider, cwd))
  handle('system.mcpAdd', async (_e, input: McpAddInput, cwd?: string) => { const r = await addMcpServer(input, cwd); void refreshLiveMcpNames(cwd); return r })
  // Command-line access (D-117): the Settings ▸ Tools ▸ Command line section.
  handle('system.cliStatus', () => cliStatus())
  handle('system.cliInstall', () => installCli())
  handle('system.mcpRemove', (_e, name: string, scope?: string, cwd?: string) => removeMcpServer(name, scope, cwd))
}
