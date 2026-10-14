import { promises as fs, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { join, relative, resolve, sep, basename, dirname } from 'path'
import type { FileNode, FileSearchResult } from '../../shared/types'
import { removeTempDir } from '../util/tempFiles'
import { dirSkipReason } from './treeLimits'

// Directories we never show or traverse.
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store', '.workbench'])

// Guard: ensure a resolved target stays inside root. Throws otherwise.
export function ensureInside(root: string, target: string): string {
  const r = resolve(root)
  const t = resolve(root, target)
  if (t !== r && !t.startsWith(r + sep)) {
    throw new Error('Path escapes project folder')
  }
  return t
}

const toRel = (root: string, abs: string): string => {
  const rel = relative(root, abs)
  return rel.split(sep).join('/')
}

// Walk a project folder (or `sub`, a folder inside it) into a tree. Bounded (D-068):
// heavy folders, depth past the cap and anything after the entry cap come back as
// `truncated` dirs with no children; the UI loads one on request via `sub`.
export async function listTree(root: string, sub = ''): Promise<FileNode> {
  const rootAbs = resolve(root)
  const startAbs = sub ? ensureInside(rootAbs, sub) : rootAbs
  let count = 0
  async function walk(absDir: string, depth: number): Promise<FileNode[]> {
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes: FileNode[] = []
    for (const e of entries) {
      if (IGNORED.has(e.name) || e.name.startsWith('.')) continue
      const abs = join(absDir, e.name)
      count++
      if (e.isDirectory()) {
        const skip = dirSkipReason(e.name, depth, count)
        nodes.push(skip
          ? { name: e.name, relPath: toRel(rootAbs, abs), type: 'dir', children: [], truncated: skip }
          : { name: e.name, relPath: toRel(rootAbs, abs), type: 'dir', children: await walk(abs, depth + 1) })
      } else if (e.isFile()) {
        let mtime = 0
        try { mtime = (await fs.stat(abs)).mtimeMs } catch { /* ignore */ }
        nodes.push({ name: e.name, relPath: toRel(rootAbs, abs), type: 'file', mtime })
      }
    }
    // dirs first, then files, each alphabetical
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
    )
    return nodes
  }
  return { name: basename(startAbs), relPath: sub ? toRel(rootAbs, startAbs) : '', type: 'dir', children: await walk(startAbs, 0) }
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8'
}

// MIME type for a path's extension (images, pdf, …); octet-stream otherwise.
export function mimeForPath(rel: string): string {
  const ext = rel.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

// Write base64 bytes to a file inside root (creating parent dirs). For attachments.
export async function writeBinary(root: string, relPath: string, base64: string): Promise<void> {
  const abs = ensureInside(root, relPath)
  await fs.mkdir(dirname(abs), { recursive: true })
  await fs.writeFile(abs, Buffer.from(base64, 'base64'))
}

// Read a (binary) file as a data: URL — used to show images in the artifact viewer.
export async function readDataUrl(root: string, relPath: string): Promise<string> {
  const abs = ensureInside(root, relPath)
  const buf = await fs.readFile(abs)
  const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME[ext] ?? 'application/octet-stream'
  return `data:${mime};base64,${buf.toString('base64')}`
}

// Text previews are capped; a bigger file is opened in its own app instead.
const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024
// Error messages the renderer matches on (they survive IPC as part of the message).
const FILE_BINARY = 'FILE_BINARY'
const FILE_TOO_LARGE = 'FILE_TOO_LARGE'

/** Heuristic: a NUL byte, or many control characters, in the first 8 KB means "not text". */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  if (n === 0) return false
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]
    if (b === 0) return true
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) ctrl++
  }
  return ctrl / n > 0.1
}

// Read a file as UTF-8 text. Refuses binaries and very large files so the UI never
// renders a JPEG's bytes as text (it shows "can't preview" + Show in Finder instead).
export async function readTextFile(root: string, relPath: string): Promise<string> {
  const abs = ensureInside(root, relPath)
  const { size } = await fs.stat(abs)
  if (size > TEXT_PREVIEW_MAX_BYTES) throw new Error(FILE_TOO_LARGE)
  const buf = await fs.readFile(abs)
  if (looksBinary(buf)) throw new Error(FILE_BINARY)
  return buf.toString('utf8')
}

export async function writeTextFile(root: string, relPath: string, content: string): Promise<void> {
  const abs = ensureInside(root, relPath)
  await fs.mkdir(dirname(abs), { recursive: true }) // create parent dirs (e.g. notes/) if missing
  await fs.writeFile(abs, content, 'utf8')
}


// Extensions we treat as searchable text (skip binaries entirely).
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'text', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'sql', 'log'
])
const SEARCH_MAX_FILES = 5000       // stop walking after this many text files
const SEARCH_MAX_FILE_BYTES = 1_500_000
const SEARCH_PER_FILE_HITS = 20     // cap lines returned per file
const SEARCH_TOTAL_HITS = 500       // overall cap across all files

// Full-text search across a project folder. Case-insensitive substring match on
// each line of every text file (dirs/dotfiles/binaries skipped), capped so a huge
// corpus can't stall the UI. Returns matches grouped by file, sorted by path.
export async function searchFiles(root: string, query: string): Promise<FileSearchResult[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const rootAbs = resolve(root)

  // Collect candidate text files (bounded).
  const files: string[] = []
  async function collect(absDir: string): Promise<void> {
    if (files.length >= SEARCH_MAX_FILES) return
    let entries
    try { entries = await fs.readdir(absDir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= SEARCH_MAX_FILES) return
      if (IGNORED.has(e.name) || e.name.startsWith('.')) continue
      const abs = join(absDir, e.name)
      if (e.isDirectory()) { if (dirSkipReason(e.name, 0, 0) !== 'heavy') await collect(abs) }
      else if (e.isFile()) {
        const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
        if (TEXT_EXT.has(ext)) files.push(abs)
      }
    }
  }
  await collect(rootAbs)
  files.sort((a, b) => a.localeCompare(b))

  const results: FileSearchResult[] = []
  let total = 0
  for (const abs of files) {
    if (total >= SEARCH_TOTAL_HITS) break
    try {
      const stat = await fs.stat(abs)
      if (stat.size > SEARCH_MAX_FILE_BYTES) continue
      const text = await fs.readFile(abs, 'utf8')
      if (!text.toLowerCase().includes(q)) continue
      const hits: { line: number; text: string }[] = []
      const lines = text.split('\n')
      for (let i = 0; i < lines.length && hits.length < SEARCH_PER_FILE_HITS && total < SEARCH_TOTAL_HITS; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          hits.push({ line: i + 1, text: lines[i].trim().slice(0, 200) })
          total++
        }
      }
      if (hits.length) results.push({ relPath: toRel(rootAbs, abs), hits })
    } catch { /* unreadable — skip */ }
  }
  return results
}


// Extract a PDF's text layer using macOS PDFKit via JXA (osascript) — built into
// macOS, so it needs no poppler and no agent shell. Runs in the app's own process,
// independent of the agent's Bash toggle. Returns '' on any failure or for a
// scanned PDF with no text layer (D-044 correction).
export function extractPdfText(absPath: string): string {
  if (process.platform !== 'darwin') return ''
  try {
    const jxa = "ObjC.import('Quartz');function run(argv){try{var u=$.NSURL.fileURLWithPath($(argv[0]));var d=$.PDFDocument.alloc.initWithURL(u);if(!d||d.isNil())return '';var s=d.string;return (s&&!s.isNil())?ObjC.unwrap(s):'';}catch(e){return '';}}"
    const dir = mkdtempSync(join(tmpdir(), 'wb-pdf-'))
    try {
      const sf = join(dir, 'extract.js')
      writeFileSync(sf, jxa, 'utf8')
      const out = execFileSync('osascript', ['-l', 'JavaScript', sf, absPath], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000
      })
      return out || ''
    } finally { removeTempDir(dir) }   // audit #10: was left behind on every extraction
  } catch { return '' }
}

// IPC helper: extract text from a PDF inside a project folder.
export function readPdfText(root: string, relPath: string): string {
  return extractPdfText(ensureInside(root, relPath))
}

// Which of these project-relative paths currently exist as files. Used by the
// artifact list so deleted temporaries drop out (D-062). Unreadable → not existing.
export async function existingFiles(root: string, relPaths: string[]): Promise<string[]> {
  const out: string[] = []
  await Promise.all(relPaths.slice(0, 200).map(async (rel) => {
    try {
      const st = await fs.stat(ensureInside(root, rel))
      if (st.isFile()) out.push(rel)
    } catch { /* missing or escapes root */ }
  }))
  return out
}
