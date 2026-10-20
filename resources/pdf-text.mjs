// Windows PDF text extraction (D-120). Run by Troupe as `Troupe.exe pdf-text.mjs <pdfjs dir> <file>`
// with ELECTRON_RUN_AS_NODE=1; prints the PDF's text layer. macOS uses PDFKit instead.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , dir, file] = process.argv
// pdf.js logs optional-module warnings to stdout at load; only the text may go there.
console.log = console.warn = console.info = () => {}
try {
  const pdfjs = await import(pathToFileURL(join(dir, 'pdf.mjs')).href)
  globalThis.pdfjsWorker = await import(pathToFileURL(join(dir, 'pdf.worker.mjs')).href)
  const data = new Uint8Array(await readFile(file))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    pages.push(tc.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join(''))
  }
  process.stdout.write(pages.join('\n\n'))
} catch {
  process.exitCode = 1
}
