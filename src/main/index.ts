import { app, BrowserWindow, nativeImage, protocol } from 'electron'
import { listProjects } from './projects/projectsRepo'
import { hideWorkbenchDir } from './platform/winFs'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { existsSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import { getDb, closeDb } from './database/db'
import { registerProjectIpc } from './ipc/projects'
import { registerFileIpc } from './ipc/files'
import { registerConversationIpc } from './ipc/conversations'
import { guardNavigation, openExternalSafely } from './ipc/handle'
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
import { registerVoiceIpc, releaseVoice } from './ipc/voice'
import { cancelAllImageRuns } from './image/imageService'
import { thumbnail, pruneThumbs, type ThumbImage } from './image/thumbs'
import { registerDefaultProviders } from './providers/registry'
import { loadCustomAgents } from './agents/customAgentStore'
import { refreshLiveMcpNames } from './tools/toolsService'
import { cancelAllRuns } from './agent/runner'
import { logInfo, logError } from './util/logger'
import { stopWatch } from './filesystem/watcher'
import { refreshCliAccess, stopCliServer } from './cli/cliAccess'
import { initRunLog } from './agent/runLog'
import { ensureInside, mimeForPath } from './filesystem/fsService'
import { parseRange, isRangeMedia } from './filesystem/byteRange'
import { assertProjectRoot } from './security/roots'
import { DOCUMENT_CSP, isDocumentMime } from './security/documentCsp'
import { migrateProjectMcpOff } from './tools/mcpMigration'
import { migrateExtraModels } from './tools/codexModels'
import { setWinPdfPaths } from './platform/winPdf'
import { initWinApp, attachWinWindow } from './platform/winShell'
import { runSmoke } from './platform/smoke'

// Display name is "Troupe", but keep userData at ".../AI Workbench" so existing data
// (workbench.db) survives the rename — app.setName also decides the userData folder (spec §54).
app.setPath('userData', join(app.getPath('appData'), 'AI Workbench'))
app.setName('Troupe')
// D-120: Windows — notifications id, single running copy, tray (platform/winShell.ts).
if (process.platform === 'win32') initWinApp()

// Serve project files to the renderer over a real URL (wbfile://file/?root=&path=),
// so Chromium's PDF viewer and <img>/<iframe> render them (data: URLs blank out for
// PDFs). Must be declared privileged before the app is ready.
protocol.registerSchemesAsPrivileged([
  // corsEnabled: pdf.js loads the document with fetch() from the renderer origin; from
  // Electron 44 a cross-origin fetch to a custom scheme is refused (status 0) unless the
  // scheme opts in and the response carries Access-Control-Allow-Origin.
  // No bypassCSP: an HTML file served from here must obey its own CSP (below).
  { scheme: 'wbfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

// App icon (dev: set the Dock icon at runtime; packaging picks up build/icon.png).
const iconPath = join(app.getAppPath(), 'build', 'icon.png')
const appIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Troupe',
    ...(appIcon ? { icon: appIcon } : {}),
    // Windows (D-120): the native title bar (no traffic lights), menu bar hidden until Alt.
    ...(process.platform === 'win32'
      ? { autoHideMenuBar: true }
      : { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }),
    backgroundColor: '#1a1915',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true // Chromium built-in PDF viewer for pdf artifacts
    }
  })

  mainWindow = win
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
  if (process.platform === 'win32') attachWinWindow(() => mainWindow, win)
  runSmoke(win)   // CI only (TROUPE_SMOKE_OUT); no-op otherwise
  win.webContents.setWindowOpenHandler(({ url }) => openExternalSafely(url)) // http(s)/mailto only; never wbfile:
  guardNavigation(win.webContents)   // D-100: a dropped or clicked page never replaces the app

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const thumbDeps = {
  get dir() { return join(app.getPath('userData'), 'thumbs') },
  // macOS QuickLook / Windows shell thumbnails decode off the main thread; elsewhere decode here.
  osThumb: process.platform === 'darwin' || process.platform === 'win32'
    ? (abs: string, w: number) => nativeImage.createThumbnailFromPath(abs, { width: w, height: w * 4 }) as Promise<ThumbImage>
    : undefined,
  decode: (abs: string) => nativeImage.createFromPath(abs) as ThumbImage
}

app.whenReady().then(() => {
  void pruneThumbs(thumbDeps.dir).catch(() => {})
  // Windows: projects made before D-130 get their .workbench folder hidden too.
  if (process.platform === 'win32') setTimeout(() => { try { for (const p of listProjects()) hideWorkbenchDir(p.folderPath) } catch { /* not ready */ } }, 5000)
  logInfo('app ready', { version: app.getVersion?.() })
  protocol.handle('wbfile', async (req) => {
    try {
      const u = new URL(req.url)
      const root = u.searchParams.get('root') || ''
      const rel = u.searchParams.get('path') || ''
      const abs = ensureInside(assertProjectRoot(root), rel) // root must be a connected folder; rel must stay under it
      const mime = mimeForPath(rel)
      // `&w=N`: a cached small copy for card previews (image perf, 2026-10).
      const w = Number(u.searchParams.get('w'))
      if (w > 0) {
        const t = await thumbnail(abs, w, thumbDeps).catch(() => null)
        if (t) return new Response(new Uint8Array(t.body), { headers: { 'content-type': t.mime, 'content-length': String(t.body.byteLength), 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' } })
      }
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
          ...(isDocumentMime(mime) ? { 'content-security-policy': DOCUMENT_CSP } : {}),
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
  if (process.platform === 'win32') {
    // D-120: pdf.js for PDF text (macOS uses PDFKit).
    const res = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    setWinPdfPaths(join(res, 'pdf-text.mjs'), app.isPackaged ? join(process.resourcesPath, 'pdfjs') : join(app.getAppPath(), 'node_modules', 'pdfjs-dist', 'legacy', 'build'))
  }
  try { getDb() } catch (e) { logError('startup failed', String(e)); throw e }
  // Park collab runs the previous process left mid-flight (D-060 item 4).
  sweepInterruptedTurns()
  try { migrateProjectMcpOff() } catch (e) { logError('mcp migration failed', String(e)) }
  try { migrateExtraModels() } catch (e) { logError('model list migration failed', String(e)) }
  try { loadCustomAgents() } catch (e) { logError('custom agents failed to load', String(e)) }
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
  registerVoiceIpc()
  try { seedAndMigrateSkills() } catch { /* non-fatal */ }
  refreshSkillsWatch()
  createWindow()
  startScheduler()
  initRunLog(join(app.getPath('userData'), 'run-log.jsonl'))   // D-118: `troupe runs`
  void refreshCliAccess()   // D-117: open the CLI socket if Command line access is on
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => { void cancelAllRuns(); void cancelAllImageRuns(); stopWatch(); stopSkillsWatch(); stopScheduler(); stopCliServer(); releaseVoice(); closeDb(); logInfo('app quit') })
