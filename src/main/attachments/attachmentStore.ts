import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { extractPdfText } from '../filesystem/fsService'

// App-managed attachment store, independent of any project folder — so folderless
// projects can still attach binaries (images, PDFs, …) for the agent to read.
export function attachmentsDir(): string {
  return join(app.getPath('userData'), 'attachments')
}

// Save base64 bytes; returns the ABSOLUTE path the agent can read.
export async function saveAttachmentBinary(base64: string, name: string): Promise<string> {
  const dir = attachmentsDir()
  await fs.mkdir(dir, { recursive: true })
  const safe = name.replace(/[^\w.\-]+/g, '_')
  const abs = join(dir, `${Date.now()}-${safe}`)
  await fs.writeFile(abs, Buffer.from(base64, 'base64'))
  return abs
}

// Extract a PDF's text from an absolute path in the store (macOS PDFKit).
export function extractAttachmentPdf(absPath: string): Promise<string> {
  return extractPdfText(absPath)
}
