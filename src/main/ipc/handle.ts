import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import type { InvokePath, InvokeFn } from '../../shared/contract'
import { logError } from '../util/logger'
import { isSafeExternalUrl } from '../security/pathGuard'

// D-097: the one way main answers a window's request. The channel is the API path and
// the handler's arguments are typed from WorkbenchApi, so main and the renderer cannot
// drift apart. Every request also gets the same treatment here: only the app's own
// windows may call, and a failure is logged with its path before it reaches the window.

const appFileUrl = (): string => pathToFileURL(join(__dirname, '../renderer/index.html')).href
const base = (u: string): string => { try { return decodeURI(u.split(/[?#]/)[0]) } catch { return u.split(/[?#]/)[0] } }

/**
 * The app shell: exactly our index.html when packaged (any query — the artifact window
 * adds one), or electron-vite's dev server origin. Not any file:// page: a dropped .html
 * file would otherwise get the whole API (review finding, D-100).
 */
export function isAppUrl(url: string, devRendererUrl = process.env.ELECTRON_RENDERER_URL, appUrl = appFileUrl()): boolean {
  if (url.startsWith('file://')) return base(url) === base(appUrl)
  if (!devRendererUrl) return false
  try { return new URL(url).origin === new URL(devRendererUrl).origin } catch { return false }
}

/** Keep an app window on the app: block navigation elsewhere; web links open in the browser. */
export function guardNavigation(wc: WebContents): void {
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
}

/** window.open / target=_blank: web and mail links go to the OS; everything else is dropped. */
export function openExternalSafely(url: string): { action: 'deny' } {
  if (isSafeExternalUrl(url)) void shell.openExternal(url)
  return { action: 'deny' }
}
const trustedSender = (e: IpcMainInvokeEvent): boolean => isAppUrl(e.senderFrame?.url ?? '')

export function handle<P extends InvokePath>(
  path: P,
  fn: (e: IpcMainInvokeEvent, ...args: Parameters<InvokeFn<P>>) => unknown
): void {
  ipcMain.handle(path, async (e, ...args) => {
    if (!trustedSender(e)) throw new Error(`Refused ${path}: not an app window`)
    try {
      return await fn(e, ...(args as Parameters<InvokeFn<P>>))
    } catch (err) {
      logError(`ipc ${path} failed`, err instanceof Error ? err.message : String(err))
      throw err
    }
  })
}
