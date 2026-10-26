// Windows PDF text (D-120). macOS reads the text layer with PDFKit (osascript); Windows has
// no equivalent built in, so Troupe runs pdf.js in a child copy of itself acting as node
// (ELECTRON_RUN_AS_NODE) — asynchronous, like the macOS path (audit #7). index.ts sets where the script
// and pdf.js live (packaged: resources/; dev: the repo).
import { execFile } from 'child_process'

let paths: { script: string; pdfjsDir: string } | null = null

export function setWinPdfPaths(script: string, pdfjsDir: string): void { paths = { script, pdfjsDir } }

export function winPdfText(absPath: string): Promise<string> {
  if (!paths) return Promise.resolve('')
  const p = paths
  return new Promise((resolve) => {
    try {
      execFile(process.execPath, [p.script, p.pdfjsDir, absPath], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      }, (err, out) => resolve(err ? '' : out || ''))
    } catch { resolve('') }
  })
}
