import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../api'
import MessageMarkdown from './MessageMarkdown'
import Icon from './Icon'
// D-092: pdf.js (~400 KB) loads the first time a PDF is opened.
const PdfViewer = lazy(() => import('./PdfViewer'))

interface Props { root: string; relPath: string; onClose: () => void; popout?: boolean }

type Kind = 'md' | 'html' | 'image' | 'video' | 'pdf' | 'csv' | 'json' | 'text'
const kindOf = (rel: string): Kind => {
  const ext = rel.split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'markdown'].includes(ext)) return 'md'
  if (['html', 'htm'].includes(ext)) return 'html'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (['csv', 'tsv'].includes(ext)) return 'csv'
  if (ext === 'json') return 'json'
  return 'text'
}
const isBinary = (k: Kind): boolean => k === 'image'

// Collapse ./ and ../ segments in a POSIX-ish path.
const normalizePath = (p: string): string => {
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
  const indent = { paddingLeft: depth * 14 + 6 }
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

export default function ArtifactViewer({ root, relPath, onClose, popout }: Props) {
  const [current, setCurrent] = useState(relPath)
  const [text, setText] = useState<string>('')
  const [dataUrl, setDataUrl] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { setCurrent(relPath) }, [relPath])

  const kind = kindOf(current)
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* ignore */ } }
  const copyImage = async () => { const ok = await api.system.copyImage(root, current); if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1200) } }

  useEffect(() => {
    let alive = true
    setText(''); setDataUrl(''); setError(null)
    if (kind === 'pdf' || kind === 'video') return // rendered straight from a wbfile:// URL below
    const run = async () => {
      try {
        if (isBinary(kind)) setDataUrl(await api.files.readDataUrl(root, current))
        else setText(await api.files.readFile(root, current))
      } catch (e) { if (alive) setError(String(e)) }
    }
    run()
    return () => { alive = false }
  }, [root, current, kind])

  const openLink = (href: string) => {
    let h = href
    if (h.startsWith(root + '/')) h = h.slice(root.length + 1)
    else if (!h.startsWith('/')) {
      const dir = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''
      h = normalizePath(dir ? `${dir}/${h}` : h)
    }
    setCurrent(h)
  }

  return (
    <div className="artifact-viewer" data-artifact-path={current}>
      <div className="artifact-head">
        <span className="artifact-title truncate" title={current}>{current.split('/').pop()}</span>
        <div className="artifact-actions">
          {popout && (
            <button className="icon-btn" onClick={() => api.system.openArtifactWindow(root, current)} title="Open in new window"><Icon name="popout" size={15} /></button>
          )}
          <button className="icon-btn" onClick={() => api.system.revealItem(root, current)} title="Show in Finder"><Icon name="folder-open" size={16} /></button>
          {(kind === 'pdf' || kind === 'video') && (
            <button className="icon-btn" onClick={() => api.system.openItem(root, current)} title={kind === 'pdf' ? 'Open in Preview' : 'Open in default app'}><Icon name="external" size={15} /></button>
          )}
          {!isBinary(kind) && text && (
            <button className="icon-btn" onClick={copy} title={copied ? 'Copied' : 'Copy'}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
          )}
          {kind === 'image' && (
            <button className="icon-btn" onClick={copyImage} title={copied ? 'Copied' : 'Copy image'}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </div>
      </div>
      <div className="artifact-body">
        {error && <div className="field-hint">Couldn't open this file: {error}</div>}
        {!error && kind === 'image' && dataUrl && <img className="artifact-image" src={dataUrl} alt={current} />}
        {!error && kind === 'video' && <video key={current} className="artifact-video" src={`wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(current)}`} controls preload="metadata"
          onError={() => setError('this video format can\'t play here. Use “Open in default app” above.')} />}
        {!error && kind === 'pdf' && <Suspense fallback={<div className="field-hint">Loading PDF viewer…</div>}><PdfViewer url={`wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(current)}`} root={root} relPath={current} onPageTextChange={setText} /></Suspense>}
        {!error && kind === 'md' && <div className="markdown-body"><MessageMarkdown onOpenArtifact={openLink} root={root}>{text}</MessageMarkdown></div>}
        {!error && kind === 'html' && (
          // Interactive: scripts run in an opaque origin (no allow-same-origin), so the
          // page can't reach the app, cookies, or local files. Forms/popups/modals allowed.
          // Loaded by URL rather than srcDoc: Chromium 152 (Electron 44) paints a sandboxed
          // srcdoc frame blank inside a sandboxed renderer; a wbfile:// src renders, and
          // relative links (images next to the file) resolve too. Origin stays opaque.
          <iframe className="artifact-frame" title={current} sandbox="allow-scripts allow-popups allow-forms allow-modals" src={`wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(current)}`} />
        )}
        {!error && kind === 'csv' && <CsvTable text={text} tab={current.toLowerCase().endsWith('.tsv')} />}
        {!error && kind === 'json' && <JsonView text={text} />}
        {!error && kind === 'text' && <pre className="artifact-text">{text}</pre>}
      </div>
    </div>
  )
}
