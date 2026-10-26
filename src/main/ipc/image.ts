import { dialog, BrowserWindow } from 'electron'
import { handle } from './handle'
import { expectString } from '../security/pathGuard'
import {
  getImageFolder, setImageFolder, loadCanvas, saveCanvas, applyRunResultTo, clearCanvas, importMedia, startImageRun, cancelImageRun,
  saveImage, unsaveImage, deleteRun,
  canvasIndex, setActiveCanvas, createCanvas, renameCanvas, duplicateCanvas, deleteCanvas
} from '../image/imageService'
import type { Canvas, ImageRunInput, RunRecord } from '../../shared/imageCanvas'

// Image canvas (D-088).
export function registerImageIpc(): void {
  handle('image.folder', () => getImageFolder())
  handle('image.pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder for Image', buttonLabel: 'Use this folder' })
    if (res.canceled || !res.filePaths.length) return null
    return setImageFolder(res.filePaths[0])
  })
  handle('image.canvases', () => canvasIndex())
  handle('image.load', (_e, id: string) => loadCanvas(expectString(id, 'canvas')))
  handle('image.save', (_e, id: string, c: Canvas) => saveCanvas(expectString(id, 'canvas'), c))
  handle('image.applyRunResult', (_e, id: string, processorId: string, rec: Omit<RunRecord, 'agent' | 'model'>, outputX?: number) => applyRunResultTo(expectString(id, 'canvas'), expectString(processorId, 'card'), rec, typeof outputX === 'number' ? outputX : undefined))
  handle('image.clear', (_e, id: string) => clearCanvas(expectString(id, 'canvas')))
  handle('image.setActive', (_e, id: string) => setActiveCanvas(expectString(id, 'canvas')))
  handle('image.createCanvas', (_e, after?: string) => createCanvas(typeof after === 'string' ? after : undefined))
  handle('image.renameCanvas', (_e, id: string, name: string) => renameCanvas(expectString(id, 'canvas'), typeof name === 'string' ? name : ''))
  handle('image.duplicateCanvas', (_e, id: string) => duplicateCanvas(expectString(id, 'canvas')))
  handle('image.deleteCanvas', (_e, id: string) => deleteCanvas(expectString(id, 'canvas')))
  handle('image.importMedia', (_e, base64: string, name: string) => importMedia(expectString(base64, 'data'), typeof name === 'string' ? name : 'image.png'))
  handle('image.run', (e, input: ImageRunInput) => startImageRun(e.sender, input))
  handle('image.saveImage', (_e, rel: string, hint: string) => saveImage(expectString(rel, 'path'), typeof hint === 'string' ? hint : ''))
  handle('image.unsaveImage', (_e, rel: string) => unsaveImage(expectString(rel, 'path')))
  handle('image.deleteRun', (_e, runId: string, fromCanvas?: string) => deleteRun(expectString(runId, 'runId'), typeof fromCanvas === 'string' ? fromCanvas : ''))
  handle('image.cancel', (_e, runId: string) => cancelImageRun(expectString(runId, 'runId')))
}
