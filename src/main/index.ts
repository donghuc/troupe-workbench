import { app, BrowserWindow, shell, nativeImage, protocol } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { existsSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import { getDb, closeDb } from './database/db'
import { registerProjectIpc } from './ipc/projects'
import { registerFileIpc } from './ipc/files'
import { registerConversationIpc } from './ipc/conversations'
import { guardNavigation } from './ipc/handle'
import { registerAgentIpc } from './ipc/agent'
import { registerContextIpc } from './ipc/context'
import { registerSkillIpc } from './ipc/skills'
import { registerCollabIpc } from './ipc/collab'
import { sweepInterruptedRuns } from './collab/collabRepo'
import { sweepInterruptedTurns } from './agent/turns'
import { sweepStaleTempDirs } from './util/tempFiles'
import { registerNoteIpc } from './ipc/notes'
import { registerMemoryIpc } from './ipc/memory'
import { registerScheduleIpc } from './ipc/schedules'
import { startScheduler, stopScheduler } from './schedules/scheduler'
import { seedAndMigrateSkills } from './skills/skillsFs'
import { refreshSkillsWatch, stopSkillsWatch } from './skills/skillsWatcher'
import { registerSystemIpc } from './ipc/system'
import { registerImageIpc } from './ipc/image'
import { cancelAllImageRuns } from './image/imageService'
import { registerDefaultProviders } from './providers/registry'
import { refreshLiveMcpNames } from './tools/toolsService'
import { cancelAllRuns } from './agent/runner'
import { logInfo, logError } from './util/logger'
import { stopWatch } from './filesystem/watcher'
import { ensureInside, mimeForPath } from './filesystem/fsService'
import { parseRange, isRangeMedia } from './filesystem/byteRange'
import { assertProjectRoot } from './security/roots'
import { migrateProjectMcpOff } from './tools/mcpMigration'
import { migrateExtraModels } from './tools/codexModels'

// Display name is "Troupe", but keep userData at ".../AI Workbench" so existing data
// (workbench.db) survives the rename — app.setName also decides the userData folder (spec §54).
app.setPath('userData', join(app.getPath('appData'), 'AI Workbench'))
app.setName('Troupe')

// Serve project files to the renderer over a real URL (wbfile://file/?root=&path=),
// so Chromium's PDF viewer and <img>/<iframe> render them (data: URLs blank out for
// PDFs). Must be declared privileged before the app is ready.
protocol.registerSchemesAsPrivileged([
  // corsEnabled: pdf.js loads the document with fetch() from the renderer origin; from
  // Electron 44 a cross-origin fetch to a custom scheme is refused (status 0) unless the
  // scheme opts in and the response carries Access-Control-Allow-Origin.
  { scheme: 'wbfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }
])

// App icon (dev: set the Dock icon at runtime; packaging picks up build/icon.png).
const iconPath = join(app.getAppPath(), 'build', 'icon.png')
const appIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Troupe',
    ...(appIcon ? { icon: appIcon } : {}),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1915',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true // Chromium built-in PDF viewer for pdf artifacts
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^wbfile:/i.test(url)) shell.openExternal(url) // never hand our internal scheme to the OS
    return { action: 'deny' }
  })
  guardNavigation(win.webContents)   // D-100: a dropped or clicked page never replaces the app

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  logInfo('app ready', { version: app.getVersion?.() })
  protocol.handle('wbfile', async (req) => {
    try {
      const u = new URL(req.url)
      const root = u.searchParams.get('root') || ''
      const rel = u.searchParams.get('path') || ''
      const abs = ensureInside(assertProjectRoot(root), rel) // root must be a connected folder; rel must stay under it
      const mime = mimeForPath(rel)
      // Video/audio: stream with byte ranges (206), which Chromium's player needs to play and
      // seek MP4s. Other files keep the whole-file answer (pdf.js relies on it).
      if (isRangeMedia(mime)) {
        const size = (await fsp.stat(abs)).size
        const base = { 'content-type': mime, 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
        const r = parseRange(req.headers.get('range'), size)
        if (r === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } })
        const { start, end } = r ?? { start: 0, end: size - 1 }
        const body = size ? (Readable.toWeb(createReadStream(abs, { start, end })) as unknown as ReadableStream) : null
        return new Response(body, {
          status: r ? 206 : 200,
          headers: { ...base, 'content-length': String(size ? end - start + 1 : 0), ...(r ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) }
        })
      }
      const buf = await fsp.readFile(abs)
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': mime,
          'content-length': String(buf.byteLength),
          'access-control-allow-origin': '*',
          'accept-ranges': 'none'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  if (process.platform === 'darwin' && app.dock && appIcon) { try { app.dock.setIcon(appIcon) } catch { /* non-fatal */ } }
  try { getDb() } catch (e) { logError('startup failed', String(e)); throw e }
  // Park collab runs the previous process left mid-flight (D-060 item 4).
  sweepInterruptedTurns()
  try { migrateProjectMcpOff() } catch (e) { logError('mcp migration failed', String(e)) }
  try { migrateExtraModels() } catch (e) { logError('model list migration failed', String(e)) }
  // audit #10: temp folders left by older versions or crashes
  setTimeout(() => { const n = sweepStaleTempDirs(); if (n) logInfo(`removed ${n} leftover temp folder(s)`) }, 5000)
  try { const swept = sweepInterruptedRuns(); if (swept.runs || swept.tasks) logInfo('swept interrupted collab runs', swept) } catch (e) { logError('sweep failed', String(e)) }
  registerProjectIpc()
  registerFileIpc()
  registerMemoryIpc()
  registerScheduleIpc()
  registerConversationIpc()
  registerDefaultProviders()
  void refreshLiveMcpNames() // warm MCP names (incl. account connectors) for headless Auto allowlisting
  registerAgentIpc()
  registerContextIpc()
  registerSkillIpc()
  registerCollabIpc()
  registerNoteIpc()
  registerSystemIpc()
  registerImageIpc()
  try { seedAndMigrateSkills() } catch { /* non-fatal */ }
  refreshSkillsWatch()
  createWindow()
  startScheduler()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => { void cancelAllRuns(); void cancelAllImageRuns(); stopWatch(); stopSkillsWatch(); stopScheduler(); closeDb(); logInfo('app quit') })
