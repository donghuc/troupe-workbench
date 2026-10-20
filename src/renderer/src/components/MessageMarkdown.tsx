import { memo, useState, useMemo, useRef, isValidElement, Children, type ReactNode } from 'react'
import { OS_WORDS, isAbsPath, relUnder } from '../../../shared/platform'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Icon, { type IconName } from './Icon'
import { linkUrlTransform, normalizeRel } from '../links'
import { api } from '../api'

import { ARTIFACT_EXT } from '../chatFiles'
import { Button } from './ui/Button'
const isWebUrl = (href?: string) => !!href && /^(https?:|mailto:|tel:)/i.test(href)

// A local link the app should own (open in the viewer, never the OS browser).
const isLocalLink = (href?: string) => !!href && !isWebUrl(href) && !href.startsWith('#')
// D-086: an absolute path that is not under the project folder (or a ../ escape). Such a
// file can't be opened from the reply; the card offers Finder or a copy into the project.
const isOutsideRoot = (rel: string, root?: string): boolean =>
  rel.startsWith('../') || (isAbsPath(rel) && !!root && rel !== root && relUnder(rel, root) === null)

function OutsideFileLink({ abs, root, label, onOpen }: { abs: string; root?: string; label: ReactNode; onOpen?: (rel: string) => void }) {
  const [busy, setBusy] = useState(false)
  const importIt = async () => {
    if (!root) return
    setBusy(true)
    try { const rel = await api.system.importOutside(root, abs); if (rel) onOpen?.(rel) } finally { setBusy(false) }
  }
  return (
    <span className="outside-file" title={`${abs}\nThis file is outside the project folder, so Troupe can't open it here.`}>
      <span className="outside-file-name">{label}</span>
      <span className="outside-file-tag">outside project</span>
      <Button type="button" variant="link" className="outside-file-btn" onClick={() => { void api.system.revealOutside(abs) }}>{OS_WORDS.fileManager}</Button>
      {root && <Button type="button" variant="link" className="outside-file-btn" disabled={busy} onClick={() => { void importIt() }}>{busy ? 'Copying…' : 'Copy into project'}</Button>}
    </span>
  )
}
// A local file we can open in the viewer: not a web link, and a supported type.
const isOpenable = (href?: string) => !!href && !isWebUrl(href) && !href.startsWith('#') && ARTIFACT_EXT.test(normalizeRel(href))
const fileIcon = (p: string): IconName => (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p) ? 'image' : /\.html?$/i.test(p) ? 'globe' : 'file')
const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(p)
const isVideoPath = (p: string) => /\.(mp4|webm|mov|m4v)$/i.test(p)
// Render a local image reference (a link or ![]()) as an inline, clickable thumbnail.
// A missing file (e.g. a provider referenced an image it never actually wrote — see
// B-042) renders a graceful "image unavailable" chip instead of a broken-image icon.
function MediaThumb({ root, rel, altText, onOpen, onMedia }: { root: string; rel: string; altText?: string; onOpen?: (rel: string) => void; onMedia?: (rel: string) => void }) {
  const [failed, setFailed] = useState(false)
  const src = `wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`
  const view = onMedia ?? onOpen
  const name = rel.split('/').pop() || rel
  const isVideo = isVideoPath(rel)
  if (failed) {
    return (
      <span className="media-item media-missing" title={`${isVideo ? 'Video' : 'Image'} not found: ${rel}`}>
        <span className="media-missing-box"><Icon name={isVideo ? 'film' : 'image'} size="md" /> {isVideo ? 'Video' : 'Image'} unavailable</span>
        <span className="media-missing-path">{name}</span>
      </span>
    )
  }
  if (isVideo) {
    // Play inline with native controls; the link below opens it in the artifact viewer.
    return (
      <span className="media-item">
        <video className="msg-video" src={src} controls preload="metadata" onError={() => setFailed(true)} />
        <button type="button" className="media-open-btn" onClick={() => onOpen?.(rel)} title={`Open ${rel} in the artifact viewer`}><Icon name="popout" size="xs" /> Open as artifact</button>
      </span>
    )
  }
  // Thumbnail opens the lightbox; the link below opens it in the artifact viewer.
  return (
    <span className="media-item">
      <button type="button" className="msg-thumb-btn md-thumb-btn" onClick={() => view?.(rel)} title={`View ${rel}`}>
        <img className="msg-thumb" src={src} alt={altText || name} loading="lazy" onError={() => setFailed(true)} />
      </button>
      <button type="button" className="media-open-btn" onClick={() => onOpen?.(rel)} title={`Open ${rel} in the artifact viewer`}><Icon name="popout" size="xs" /> Open as artifact</button>
    </span>
  )
}
function imageThumb(root: string, onOpen: ((rel: string) => void) | undefined, onMedia: ((rel: string) => void) | undefined, rawHref: string, altText?: string) {
  let rel = normalizeRel(rawHref)
  const under = relUnder(rel, root)
  if (under !== null) rel = under
  rel = rel.replace(/^\/+/, '')
  return <MediaThumb root={root} rel={rel} altText={altText} onOpen={onOpen} onMedia={onMedia} />
}

// Pull plain text out of a rendered node tree (for the code copy button).
function nodeText(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (node as any)?.props
  return props ? nodeText(props.children) : ''
}

function CopyButton({ getText, className = 'copy-btn' }: { getText: () => string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(getText()); setDone(true); setTimeout(() => setDone(false), 1200) } catch { /* ignore */ }
  }
  return <button className={`${className}${done ? ' copied' : ''}`} onClick={copy} title="Copy">{done ? '✓ Copied' : 'Copy'}</button>
}


// A fenced code block with Copy and a Wrap toggle (long lines like JSON plans
// scroll horizontally by default; Wrap makes them readable without scrolling).
function CodeBlock({ kids }: { kids: ReactNode }) {
  const [wrap, setWrap] = useState(false)
  return (
    <div className="code-block">
      <div className="code-tools">
        <button className="code-tool" onClick={() => setWrap((w) => !w)} title={wrap ? 'Stop wrapping lines' : 'Wrap long lines'}>{wrap ? 'No wrap' : 'Wrap'}</button>
        <CopyButton getText={() => nodeText(kids)} className="copy-btn code-copy" />
      </div>
      <pre className={wrap ? 'wrap' : undefined}>{kids}</pre>
    </div>
  )
}

interface Props {
  children: string
  // When provided, links to local supported files open the artifact viewer instead of navigating.
  onOpenArtifact?: (relPath: string) => void
  // The project folder, used to resolve local image references into inline thumbnails.
  root?: string
  // Opens an image in the lightbox (media viewer); falls back to onOpenArtifact when absent.
  onOpenMedia?: (relPath: string) => void
}

// Is this rendered child a local image/video (an ![]() or a link to one)? react-markdown
// passes the hast `node` to custom components, so the element carries it in props.
function isMediaChild(child: ReactNode, root: string | undefined): boolean {
  if (!isValidElement(child)) return false
  const node = (child.props as { node?: { tagName?: string; properties?: { src?: unknown; href?: unknown } } }).node
  if (!node || !root) return false
  if (node.tagName === 'img') { const src = node.properties?.src; return typeof src === 'string' && isLocalLink(src) }
  if (node.tagName === 'a') {
    const href = node.properties?.href
    if (typeof href !== 'string' || !isLocalLink(href)) return false
    const rel = normalizeRel(href)
    return !isOutsideRoot(rel, root) && (isImagePath(rel) || isVideoPath(rel))
  }
  return false
}
// Media never sits in the text flow: a thumbnail inline with a sentence makes the line wrap
// around a 200px box ("… welcome screen ( [img] ), and I can't swipe"). Group consecutive
// media children of a paragraph / list item into a `.media-row` block (a span, so it is
// still valid inside <p>) that takes a whole row where the agent placed it; the text
// around it stays where it was. "Screenshots: ![a] ![b]" → label line, then a row of two.
function groupMedia(kids: ReactNode, root: string | undefined): ReactNode {
  const arr = Children.toArray(kids)
  if (!arr.some((c) => isMediaChild(c, root))) return kids
  const out: ReactNode[] = []
  let run: ReactNode[] = []
  const flush = () => { if (run.length) { out.push(<span key={`mr${out.length}`} className="media-row">{run}</span>); run = [] } }
  for (const c of arr) {
    if (isMediaChild(c, root)) { run.push(c); continue }
    // whitespace between two thumbnails belongs to the row, not the text
    if (typeof c === 'string' && !c.trim() && run.length) continue
    flush(); out.push(c)
  }
  flush()
  return out
}

function MessageMarkdown({ children, onOpenArtifact, root, onOpenMedia }: Props) {
  // The components map must keep a stable identity across re-renders. react-markdown
  // maps each node to components.<tag>; a fresh function each render makes React treat
  // <pre> as a new type and remount it — which reset CodeBlock's wrap toggle whenever
  // the thread re-rendered (e.g. on scroll). A ref lets the stable closures still read
  // the latest onOpenArtifact.
  const onOpenRef = useRef(onOpenArtifact)
  onOpenRef.current = onOpenArtifact
  const rootRef = useRef(root)
  rootRef.current = root
  const onMediaRef = useRef(onOpenMedia)
  onMediaRef.current = onOpenMedia
  const components = useMemo<Components>(() => ({
    li({ children: kids, node: _n, ...props }) { return <li {...props}>{groupMedia(kids, rootRef.current)}</li> },
    p({ children: kids, node: _n, ...props }) { return <p {...props}>{groupMedia(kids, rootRef.current)}</p> },
    a({ href, children: kids, ...props }) {
      if (isLocalLink(href)) {
        const r = rootRef.current
        const norm = normalizeRel(href!)
        if (isOutsideRoot(norm, r)) return <OutsideFileLink abs={norm} root={r} label={kids} onOpen={onOpenRef.current} />
        // A local image renders as an inline thumbnail; other files stay a link.
        if (r && (isImagePath(normalizeRel(href!)) || isVideoPath(normalizeRel(href!)))) return imageThumb(r, onOpenRef.current, onMediaRef.current, href!, nodeText(kids))
        // Always internal — never let a local file path open the OS browser.
        return (
          <a className="artifact-link" href={href} onClick={(e) => { e.preventDefault(); onOpenRef.current?.(normalizeRel(href!)) }}>
            {kids}
          </a>
        )
      }
      return <a href={href} target="_blank" rel="noreferrer" {...props}>{kids}</a>
    },
    img({ src, alt }) {
      const s = typeof src === 'string' ? src : ''
      const a = typeof alt === 'string' ? alt : undefined
      const r = rootRef.current
      if (s && isLocalLink(s)) {
        if (r) return imageThumb(r, onOpenRef.current, onMediaRef.current, s, a)
        return <span className="artifact-link">{a || s}</span>
      }
      return <img src={s} alt={a || ''} style={{ maxWidth: '100%' }} />
    },
    code({ className, children: kids }) {
      const text = nodeText(kids)
      const inlineLike = !text.includes('\n')
      // Only chip real paths (with a directory) — a bare filename mention
      // like `FEATURES.md` is ambiguous and shouldn't be clickable.
      if (onOpenRef.current && inlineLike && !className && isOpenable(text) && normalizeRel(text).includes('/')) {
        return (
          <button type="button" className="artifact-chip" onClick={() => onOpenRef.current?.(normalizeRel(text))} title={`Open ${text}`}>
            <Icon name={fileIcon(text)} size="sm" /> {text.split('/').pop()}
          </button>
        )
      }
      return <code className={className}>{kids}</code>
    },
    pre({ children: kids }) {
      return <CodeBlock kids={kids} />
    }
  }), [])
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components} urlTransform={linkUrlTransform}>
      {children}
    </ReactMarkdown>
  )
}

const REMARK_PLUGINS = [remarkGfm]

// D-090: the chat re-renders every 40 ms while an agent streams; without this every
// saved message was re-parsed by react-markdown each time. The callbacks are read through
// refs above, so only the text, the root and whether a callback exists change the output.
const sameOutput = (a: Props, b: Props): boolean =>
  a.children === b.children && a.root === b.root && !!a.onOpenArtifact === !!b.onOpenArtifact && !!a.onOpenMedia === !!b.onOpenMedia

export default memo(MessageMarkdown, sameOutput)
