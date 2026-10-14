import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../api'
import { kindOf, previewRefusal } from '../fileKinds'
import MessageMarkdown from './MessageMarkdown'
import FileUnsupported from './FileUnsupported'
// D-092: pdf.js (~400 KB) loads the first time a PDF is opened.
const PdfViewer = lazy(() => import('./PdfViewer'))

// The body of a file preview, by kind (fileKinds.ts). Shared by the artifact viewer and the
// project file browser. Unsupported or binary files get FileUnsupported, never their bytes.

// Collapse ./ and ../ segments in a POSIX-ish path.
export const normalizePath = (p: string): string => {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

// --- CSV/TSV → table ---
function parseDelimited(s: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', i = 0, inQ = false
  while (i < s.length) {
    const c = s[i]
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue } inQ = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === delim) { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}
function CsvTable({ text, tab }: { text: string; tab: boolean }) {
  const rows = parseDelimited(text, tab ? '\t' : ',')
  if (!rows.length) return <pre className="artifact-text">{text}</pre>
  const head = rows[0]
  const MAX = 500
  const body = rows.slice(1, MAX + 1)
  const more = rows.length - 1 - body.length
  return (
    <div className="csv-wrap">
      <table className="csv-table">
        <thead><tr><th className="csv-num">#</th>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}><td className="csv-num">{ri + 1}</td>{head.map((_, ci) => <td key={ci}>{r[ci] ?? ''}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <div className="csv-note">Showing first {MAX} of {rows.length - 1} rows</div>}
    </div>
  )
}

// --- JSON → collapsible tree ---
const fmt = (v: unknown): string => (typeof v === 'string' ? `"${v}"` : String(v))
const valClass = (v: unknown): string =>
  v === null ? 'json-null' : Array.isArray(v) ? 'json-arr' : `json-${typeof v}`
function JsonNode({ label, value, depth, last }: { label: string | null; value: unknown; depth: number; last: boolean }) {
  const [open, setOpen] = useState(depth < 2)
  const indent = { paddingLeft: `calc(var(--sp-1-5) + ${depth} * var(--tree-indent))` }
  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-row" style={indent}>
        {label !== null && <span className="json-key">{label}: </span>}
        <span className={`json-val ${valClass(value)}`}>{fmt(value)}</span>{last ? '' : ','}
      </div>
    )
  }
  const arr = Array.isArray(value)
  const entries: [string, unknown][] = arr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  const openB = arr ? '[' : '{', closeB = arr ? ']' : '}'
  return (
    <div className="json-node">
      <div className="json-row json-toggle" style={indent} onClick={() => setOpen((o) => !o)}>
        <span className="json-caret">{open ? '▾' : '▸'}</span>
        {label !== null && <span className="json-key">{label}: </span>}
        <span className="json-bracket">{openB}{open ? '' : ` … ${closeB}`}</span>
        {!open && <span className="json-count">{entries.length}</span>}
      </div>
      {open && <>
        {entries.map(([k, v], idx) => (
          <JsonNode key={k} label={arr ? null : k} value={v} depth={depth + 1} last={idx === entries.length - 1} />
        ))}
        <div className="json-row" style={indent}><span className="json-bracket">{closeB}</span>{last ? '' : ','}</div>
      </>}
    </div>
  )
}
function JsonView({ text }: { text: string }) {
  let data: unknown
  try { data = JSON.parse(text) } catch { return <pre className="artifact-text">{text}</pre> }
  return <div className="json-view"><JsonNode label={null} value={data} depth={0} last /></div>
}


const wbUrl = (root: string, rel: string) => `wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`

interface Props {
  root: string
  relPath: string
  /** A link inside a Markdown file was clicked (path relative to root, or absolute). */
  onOpenLink?: (href: string) => void
  /** The loaded text (for Copy) — PDFs report the current page's text. */
  onText?: (text: string) => void
}

export default function FilePreview({ root, relPath, onOpenLink, onText }: Props) {
  const kind = kindOf(relPath)
  const [text, setText] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState<'binary' | 'too-large' | null>(null)

  useEffect(() => {
    let alive = true
    setText(''); setDataUrl(''); setError(null); setRefused(null); onText?.('')
    if (kind === 'pdf' || kind === 'video' || kind === 'html' || kind === 'unsupported') return // shown by URL, or not at all
    const run = async () => {
      try {
        if (kind === 'image') { const d = await api.files.readDataUrl(root, relPath); if (alive) setDataUrl(d) }
        else { const t = await api.files.readFile(root, relPath); if (alive) { setText(t); onText?.(t) } }
      } catch (e) {
        if (!alive) return
        const r = previewRefusal(e)
        if (r) setRefused(r); else setError(String(e))
      }
    }
    run()
    return () => { alive = false }
    /* eslint-disable-next-line */
  }, [root, relPath, kind])

  if (kind === 'unsupported' || refused) return <FileUnsupported root={root} relPath={relPath} reason={refused ?? 'type'} />
  if (error) return <div className="field-hint">Couldn't open this file: {error}</div>
  return (
    <>
      {kind === 'image' && dataUrl && <img className="artifact-image" src={dataUrl} alt={relPath} />}
      {kind === 'video' && <video key={relPath} className="artifact-video" src={wbUrl(root, relPath)} controls preload="metadata"
        onError={() => setError('this video format can\'t play here. Use “Open in default app”.')} />}
      {kind === 'pdf' && <Suspense fallback={<div className="field-hint">Loading PDF viewer…</div>}><PdfViewer url={wbUrl(root, relPath)} root={root} relPath={relPath} onPageTextChange={(t) => onText?.(t)} /></Suspense>}
      {kind === 'md' && <div className="markdown-body"><MessageMarkdown onOpenArtifact={onOpenLink} root={root}>{text}</MessageMarkdown></div>}
      {kind === 'html' && (
        // Interactive: scripts run in an opaque origin (no allow-same-origin), so the
        // page can't reach the app, cookies, or local files. Forms/popups/modals allowed.
        // Loaded by URL rather than srcDoc: Chromium 152 (Electron 44) paints a sandboxed
        // srcdoc frame blank inside a sandboxed renderer; a wbfile:// src renders, and
        // relative links (images next to the file) resolve too. Origin stays opaque.
        <iframe className="artifact-frame" title={relPath} sandbox="allow-scripts allow-popups allow-forms allow-modals" src={wbUrl(root, relPath)} />
      )}
      {kind === 'csv' && <CsvTable text={text} tab={relPath.toLowerCase().endsWith('.tsv')} />}
      {kind === 'json' && <JsonView text={text} />}
      {kind === 'text' && <pre className="artifact-text">{text}</pre>}
    </>
  )
}
