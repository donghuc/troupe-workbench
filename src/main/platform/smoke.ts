// CI smoke test for the Windows build (D-120). Only when TROUPE_SMOKE_OUT is set: once the
// window has loaded, open the `troupe` pipe (whatever the setting) and write what CI needs
// to a JSON file; CI then runs the client against it and quits the app. Normal launches
// never set the variable, so this does nothing.
import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getDb } from '../database/db'
import { forceCliForSmoke } from '../cli/cliAccess'

function smokeOut(): string | undefined { return process.env.TROUPE_SMOKE_OUT || undefined }

export function runSmoke(win: BrowserWindow): void {
  const out = smokeOut()
  if (!out) return
  const report = async (rendererLoaded: boolean, error?: string) => {
    const res: Record<string, unknown> = { rendererLoaded, platform: process.platform, version: app.getVersion(), userData: app.getPath('userData') }
    try { res.projects = (getDb().prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n; res.db = true } catch (e) { res.db = false; res.dbError = String(e) }
    try { Object.assign(res, await forceCliForSmoke()) } catch (e) { res.cliError = String(e) }
    if (error) res.error = error
    try { res.title = await win.webContents.executeJavaScript('document.title') } catch { /* gone */ }
    try { res.bodyText = String(await win.webContents.executeJavaScript('document.body.innerText')).slice(0, 400) } catch { /* gone */ }
    res.client = app.isPackaged ? join(process.resourcesPath, 'troupe-cli.mjs') : join(app.getAppPath(), 'resources', 'troupe-cli.mjs')
    writeFileSync(out, JSON.stringify(res, null, 2))
  }
  win.webContents.once('did-finish-load', () => { setTimeout(() => { void report(true) }, 3000) })
  win.webContents.once('did-fail-load', (_e, code, desc) => { void report(false, `${code} ${desc}`) })
}
