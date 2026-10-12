import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { guardNavigation } from '../ipc/handle'

// Open a single artifact file in its own detached window (renders the same
// renderer in artifact-only mode via a query string).
export function openArtifactWindow(root: string, relPath: string): void {
  const win = new BrowserWindow({
    width: 820,
    height: 900,
    title: relPath.split('/').pop() || 'Artifact',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true // Chromium PDF viewer for popped-out pdf artifacts
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => { if (!/^wbfile:/i.test(url)) shell.openExternal(url); return { action: 'deny' } })
  guardNavigation(win.webContents)
  const qs = `artifact=1&root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${qs}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { search: qs })
}
