// Copy an image file to the clipboard (Image creation, viewers, file cards).
// First main's copy (decodes the file with nativeImage — PNG and JPEG for sure). If that
// can't (another format, or the write failed), draw the image the window already shows
// into a canvas and copy that as PNG — works for anything the window can display (WebP,
// GIF, AVIF…). The wbfile:// server allows any origin, so the canvas isn't tainted.
import { api } from './api'

export async function copyImageFile(root: string, rel: string, src: string): Promise<boolean> {
  if (await api.system.copyImage(root, rel).catch(() => false)) return true
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d')
    if (!g || !c.width || !c.height) return false
    g.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (!blob) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
