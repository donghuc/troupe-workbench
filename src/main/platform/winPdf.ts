// Windows PDF text (D-120). macOS reads the text layer with PDFKit (osascript); Windows has
// no equivalent built in, so Troupe runs pdf.js in a child copy of itself acting as node
// (ELECTRON_RUN_AS_NODE) — synchronous like the macOS path. index.ts sets where the script
// and pdf.js live (packaged: resources/; dev: the repo).
import { execFileSync } from 'child_process'

let paths: { script: string; pdfjsDir: string } | null = null

export function setWinPdfPaths(script: string, pdfjsDir: string): void { paths = { script, pdfjsDir } }

export function winPdfText(absPath: string): string {
  if (!paths) return ''
  try {
    return execFileSync(process.execPath, [paths.script, paths.pdfjsDir, absPath], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'ignore']
    }) || ''
  } catch { return '' }
}
