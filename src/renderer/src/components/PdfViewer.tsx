import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { api } from '../api'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type Status = 'loading' | 'ready' | 'failed'
interface RenderHandle { cancel(): void; promise: Promise<void> }
interface PdfViewerProps {
  url: string
  root?: string
  relPath?: string
  onPageTextChange?: (text: string) => void
}

// Friendly message from a pdf.js load/render error.
function errText(e: unknown): string {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'PasswordException') return 'This PDF is password-protected, so it can’t be shown here.'
  if (name === 'MissingPDFException') return 'The file couldn’t be found — it may have been moved or renamed.'
  if (name === 'InvalidPDFException') return 'This doesn’t look like a valid PDF.'
  const msg = (e as { message?: string })?.message
  return msg ? String(msg) : 'The PDF could not be opened.'
}
const isCancel = (e: unknown): boolean => (e as { name?: string })?.name === 'RenderingCancelledException'

// Slim, on-brand PDF viewer: renders a page to canvas with our own control bar
// (prev/next · page X/N · zoom · fit-width), honest loading/error states, and a
// labelled fall back to Chromium's built-in viewer.
export default function PdfViewer({ url, root, relPath, onPageTextChange }: PdfViewerProps) {
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [num, setNum] = useState(0)
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('')
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState(true)
  const [fitScale, setFitScale] = useState(1)      // effective magnification when fitting
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [useIframe, setUseIframe] = useState(false)
  const [resizeTick, setResizeTick] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)     // for destroy() (T1.2)
  const renderRef = useRef<RenderHandle | null>(null)              // for cancel() (T1.1)
  const fitRef = useRef(fit)
  fitRef.current = fit

  const name = relPath ? relPath.split('/').pop() : undefined

  // Load the document. Resets ALL per-document state (T1.3) and destroys the
  // previous document in cleanup (T1.2) — after cancelling any live render (T1.1).
  useEffect(() => {
    let alive = true
    setStatus('loading'); setErrorMsg(''); setUseIframe(false)
    setDoc(null); setNum(0); setPage(1); setPageInput(''); setScale(1); setFit(true); setFitScale(1)
    ;(async () => {
      try {
        const d = await pdfjsLib.getDocument({ url }).promise
        if (!alive) { try { d.destroy() } catch { /* noop */ } return }
        docRef.current = d
        setDoc(d); setNum(d.numPages); setStatus('ready')
      } catch (e) {
        if (alive) { setStatus('failed'); setErrorMsg(errText(e)) }
      }
    })()
    return () => {
      alive = false
      const t = renderRef.current; renderRef.current = null
      if (t) { try { t.cancel() } catch { /* noop */ } }
      const d = docRef.current; docRef.current = null
      if (d) { try { d.destroy() } catch { /* noop */ } }
    }
  }, [url])

  // Re-fit when the panel (not just the window) resizes — debounced, fit-only (T1.5).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientWidth
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      if (!fitRef.current) return
      const w = el.clientWidth
      if (Math.abs(w - last) < 2) return
      clearTimeout(timer)
      timer = setTimeout(() => { last = el.clientWidth; setResizeTick((t) => t + 1) }, 120)
    })
    ro.observe(el)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [])

  // Render the current page. Cancels the superseded task and re-checks after the
  // await so overlapping renders can't share one canvas (T1.1). Reads real padding
  // and writes the effective fit scale so zoom steps from it (T1.4).
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    let textLayerBuilder: TextLayerBuilder | null = null
    const textLayerHost = textLayerRef.current
    textLayerHost?.replaceChildren()
    onPageTextChange?.('')
    ;(async () => {
      try {
        const pg = await doc.getPage(page)
        let s = scale
        if (fit && wrapRef.current) {
          const base = pg.getViewport({ scale: 1 })
          const cs = getComputedStyle(wrapRef.current)
          const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) || 32
          s = Math.max(0.1, (wrapRef.current.clientWidth - padX) / base.width)
          if (Math.abs(s - fitScale) > 0.005) setFitScale(s)
        }
        const viewport = pg.getViewport({ scale: s })
        const canvas = canvasRef.current
        const pageContainer = pageRef.current
        if (!canvas || !pageContainer || !textLayerHost || cancelled) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const dpr = window.devicePixelRatio || 1
        const cssWidth = Math.floor(viewport.width)
        const cssHeight = Math.floor(viewport.height)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${cssHeight}px`
        pageContainer.style.width = `${cssWidth}px`
        pageContainer.style.height = `${cssHeight}px`
        pageContainer.style.setProperty('--scale-factor', String(viewport.scale))
        textLayerHost.style.width = `${cssWidth}px`
        textLayerHost.style.height = `${cssHeight}px`
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const task = pg.render({ canvasContext: ctx, viewport }) as unknown as RenderHandle
        renderRef.current = task
        await task.promise
        if (cancelled) return
        renderRef.current = null

        // TextLayerBuilder includes pdf.js's selection-boundary handling. A bare
        // TextLayer renders the glyph spans, but can make drag selection jump or
        // flicker when Chromium extends the range through empty page space.
        textLayerBuilder = new TextLayerBuilder({ pdfPage: pg })
        textLayerHost.replaceChildren(textLayerBuilder.div)
        await textLayerBuilder.render(viewport)
        if (cancelled) return

        const textContent = await pg.getTextContent()
        if (cancelled) return
        const pageText = textContent.items.map((item) => {
          if (!('str' in item)) return ''
          return `${item.str}${item.hasEOL ? '\n' : ''}`
        }).join('').replaceAll('\0', '')
        onPageTextChange?.(pageText)
      } catch (e) {
        if (isCancel(e) || cancelled) return       // superseded render — expected
        setStatus('failed'); setErrorMsg(errText(e))
      }
    })()
    return () => {
      cancelled = true
      if (textLayerBuilder) { try { textLayerBuilder.cancel() } catch { /* noop */ } }
      const t = renderRef.current; renderRef.current = null
      if (t) { try { t.cancel() } catch { /* noop */ } }
    }
  }, [doc, page, scale, fit, resizeTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const busy = status !== 'ready'
  const effScale = fit ? fitScale : scale
  const pct = Math.round(effScale * 100)
  const zoomOut = () => { setScale(Math.max(0.25, effScale - 0.2)); setFit(false) }
  const zoomIn = () => { setScale(Math.min(5, effScale + 0.2)); setFit(false) }
  const goToPage = () => {
    const n = parseInt(pageInput, 10)
    if (Number.isFinite(n) && n >= 1 && n <= num) setPage(n)
    setPageInput('')
  }

  // Failed → the labelled built-in viewer, only when the user asks for it (T1.6/Q3).
  if (status === 'failed' && useIframe) {
    return <iframe className="artifact-frame" title="pdf" src={`${url}#toolbar=0&navpanes=0`} />
  }

  if (status === 'failed') {
    return (
      <div className="pdfv">
        <div className="pdfv-error">
          <div className="pdfv-error-title">Couldn’t open{name ? ` ${name}` : ' this PDF'}</div>
          <div className="pdfv-error-msg">{errorMsg}</div>
          <div className="pdfv-error-actions">
            {root && relPath && (
              <button className="btn btn-sm" onClick={() => api.system.openItem(root, relPath)}>Open in Preview</button>
            )}
            <button className="btn btn-sm" onClick={() => setUseIframe(true)}>Try the built-in viewer</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pdfv">
      <div className="pdfv-bar">
        <button className="icon-btn" title="Previous page" disabled={busy || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
        <span className="pdfv-page">
          <input
            className="pdfv-page-input"
            value={pageInput === '' ? String(page) : pageInput}
            disabled={busy}
            aria-label="Page number"
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => { setPageInput(String(page)); e.currentTarget.select() }}
            onBlur={goToPage}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { setPageInput(''); e.currentTarget.blur() } }}
          />
          <span className="pdfv-page-total"> / {num || '…'}</span>
        </span>
        <button className="icon-btn" title="Next page" disabled={busy || num === 0 || page >= num} onClick={() => setPage((p) => Math.min(num, p + 1))}>›</button>
        <span className="pdfv-sep" />
        <button className="icon-btn" title="Zoom out" disabled={busy} onClick={zoomOut}>−</button>
        <button className="pdfv-zoom" title="Fit width" disabled={busy} onClick={() => setFit(true)}>{fit ? `Fit · ${pct}%` : `${pct}%`}</button>
        <button className="icon-btn" title="Zoom in" disabled={busy} onClick={zoomIn}>+</button>
      </div>
      <div className="pdfv-scroll" ref={wrapRef}>
        {status === 'loading'
          ? <div className="pdfv-skeleton skeleton" aria-label={`Opening${name ? ` ${name}` : ' PDF'}…`} />
          : (
            <div ref={pageRef} className="pdfv-page-container" data-page-number={page}>
              <canvas ref={canvasRef} className="pdfv-canvas" role="img" aria-label={`${name ?? 'PDF'} — page ${page} of ${num || '?'}`} />
              <div ref={textLayerRef} className="pdfv-text-layer" />
            </div>
            )}
      </div>
    </div>
  )
}
