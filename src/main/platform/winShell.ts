// Windows app shell (D-120). On macOS the app keeps running with no windows, so scheduled
// tasks and the `troupe` command keep working; Windows quits when the last window closes.
// Here closing the window hides it to a tray icon instead, and "Quit Troupe" in the tray
// menu really quits. Also: one running copy (a second launch shows the first), and an
// AppUserModelId so notifications show up.
import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

let tray: Tray | null = null
let quitting = false
let hinted = false

/** Call before app.whenReady(). Returns false when another copy is already running (this one exits). */
export function initWinApp(): boolean {
  app.setAppUserModelId('com.troupe.app')
  if (!app.requestSingleInstanceLock()) { app.exit(0); return false }
  app.on('before-quit', () => { quitting = true })
  return true
}

/** The main window: show it again on a second launch, hide it (not quit) on close. */
export function attachWinWindow(getWin: () => BrowserWindow | null, win: BrowserWindow): void {
  app.removeAllListeners('second-instance')
  app.on('second-instance', () => {
    const w = getWin()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show(); w.focus()
  })
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
    if (!hinted && tray) {
      hinted = true
      tray.displayBalloon({ title: 'Troupe is still running', content: 'Scheduled tasks and the troupe command keep working. Right-click the tray icon to quit.', iconType: 'info' })
    }
  })
  if (tray) return
  const iconFile = app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(app.getAppPath(), 'build', 'tray.png')
  const icon = existsSync(iconFile) ? nativeImage.createFromPath(iconFile) : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Troupe')
  const show = () => { const w = getWin(); if (w) { w.show(); w.focus() } }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Troupe', click: show },
    { type: 'separator' },
    { label: 'Quit Troupe', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', show)
}
