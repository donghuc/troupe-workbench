import { dialog, BrowserWindow } from 'electron'
import { promises as fsp } from 'fs'
import { handle } from './handle'
import { expectString } from '../security/pathGuard'
import { requireFolder } from '../image/imageService'
import { startMotionRun } from '../image/motionService'
import { ensureInside } from '../filesystem/fsService'
import type { MotionRunInput } from '../../shared/motion'

// Animate card (D-148): runs and Lottie export. Everything else (tabs, media, save, delete,
// stop) is the Image canvas's own — Motion lives on that canvas, in the Image folder.
export function registerMotionIpc(): void {
  handle('motion.run', (e, input: MotionRunInput) => startMotionRun(e.sender, input))
  handle('motion.exportLottie', async (e, rel: string, name: string) => {
    const src = ensureInside(requireFolder(), expectString(rel, 'path'))
    if (!/\.json$/i.test(src)) throw new Error('Not an animation')
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const base = (typeof name === 'string' && name.trim() ? name.trim() : 'animation').replace(/[^\w .-]+/g, '-').slice(0, 60)
    const res = await dialog.showSaveDialog(win!, { title: 'Export Lottie', defaultPath: `${base}.json`, filters: [{ name: 'Lottie', extensions: ['json'] }] })
    if (res.canceled || !res.filePath) return null
    await fsp.copyFile(src, res.filePath)
    return res.filePath
  })
}
