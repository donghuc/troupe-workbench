import { api } from './api'

// A file staged in the composer before send — either picked from the project
// tree or dropped in from anywhere.
export type PendingAttachment =
  | { kind: 'folder'; relPath: string }
  | { kind: 'file'; file: File }

// What the agent run actually receives.
//  - content: inlined text (text files, and PDFs whose text we extract app-side)
//  - image:   a saved image, read by path
//  - doc:     a saved binary we couldn't inline; the agent reads it by path
import type { TurnAttachment } from '../../shared/turns'
export type RunAttachment = TurnAttachment

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const PDF = /\.pdf$/i
// Types we can safely inline as text. Everything else is a binary (image/pdf/doc).
const TEXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|sql|toml|ini|log)$/i
const MAX_PDF_CHARS = 200_000

export const attachmentName = (a: PendingAttachment): string =>
  a.kind === 'folder' ? (a.relPath.split('/').pop() ?? a.relPath) : a.file.name
export const attachmentIsImage = (a: PendingAttachment): boolean => IMAGE.test(attachmentName(a))

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onerror = () => reject(r.error)
  r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)) }
  r.readAsDataURL(file)
})

// Resolve a pending attachment into the run shape. Text is inlined; images and
// other binaries are made readable by path (saved into the folder if dropped).
// PDFs get their text extracted app-side (macOS PDFKit) and inlined, so the agent
// doesn't depend on poppler or shell access to read them (D-044). Returns null if
// it can't be resolved (a binary with no project folder to store it in).
export async function resolveAttachment(a: PendingAttachment, cwd?: string): Promise<RunAttachment | null> {
  const name = attachmentName(a)
  const isImg = IMAGE.test(name)
  const isText = TEXT.test(name)
  const isPdf = PDF.test(name)

  // Text: inline the content for the agent, and keep it viewable in the artifact
  // viewer. Folder files are already on disk; dropped ones are saved a copy so they
  // have a real path to open.
  if (isText) {
    if (a.kind === 'folder') { if (!cwd) return null; return { path: a.relPath, content: await api.files.readFile(cwd, a.relPath), viewable: true } }
    const content = await a.file.text()
    if (cwd) {
      const safe = a.file.name.replace(/[^\w.\-]+/g, '_')
      const rel = `.workbench/attachments/${Date.now()}-${safe}`
      try { await api.files.writeFile(cwd, rel, content); return { path: rel, content, viewable: true } } catch { /* fall back to inline-only */ }
    }
    return { path: a.file.name, content }
  }

  // Binary (image / pdf / other): put it on disk, then reference by path. With a
  // project folder it goes in .workbench/ (relative, viewable in the app). Without
  // one it goes to the app-managed store and is referenced by ABSOLUTE path so the
  // agent can still read it — works regardless of folder.
  let path: string
  let absolute = false
  if (a.kind === 'folder') {
    path = a.relPath
  } else {
    const b64 = await toBase64(a.file)
    if (cwd) {
      const safe = a.file.name.replace(/[^\w.\-]+/g, '_')
      path = `.workbench/attachments/${Date.now()}-${safe}`
      await api.files.writeBinary(cwd, path, b64)
    } else {
      path = await api.attachments.saveBinary(b64, a.file.name)
      absolute = true
    }
  }

  if (isImg) return { path, image: true, viewable: !absolute }

  // PDF: extract text app-side and inline it (works with or without a folder); fall
  // back to a path reference (e.g. a scanned PDF with no text layer).
  if (isPdf) {
    try {
      const text = absolute ? await api.attachments.extractPdf(path) : (cwd ? await api.files.extractText(cwd, path) : '')
      if (text && text.trim()) {
        const capped = text.length > MAX_PDF_CHARS ? text.slice(0, MAX_PDF_CHARS) + '\n\n…(truncated)' : text
        return { path, content: capped, viewable: !absolute }
      }
    } catch { /* fall through to path reference */ }
  }
  return { path, doc: true, viewable: !absolute }
}
