import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { connectChecker, type Canvas, type Card, type CardView as CardDerived } from '../../../../shared/imageCanvas'
import { outPort, inPort, edgePath, CARD_W, type Pt } from './geometry'
import { CardView, type CardCtx } from './ImageCards'

// The open canvas (D-088): pan (drag the background, or two-finger scroll), zoom
// (⌘/ctrl + scroll or pinch), drag cards by their header, drag from a card's output
// port onto an input slot to connect, click an edge to remove it. No library — the
// cards have fixed geometry (geometry.ts), so edges are plain SVG paths.
//
// Built for large canvases (image perf, 2026-10):
// - Pan and zoom never go through React state while you move: the live view sits in a ref
//   and is written straight to the layer's transform once per animation frame, then
//   committed once (pointer-up, or 200 ms after the last wheel event).
// - Cards are memoized (CardShell) and get only what they show: their card, its derived
//   view, selected, and connection state. Moving one card re-renders that card.
// - Only cards near the viewport are mounted; below 40% zoom they draw as light
//   placeholders (no images).
// - A connection drag decides every target once (connectChecker); the dangling edge
//   follows the pointer without a render.

interface Props {
  canvas: Canvas
  /** Card moves and other edits (batched to one per frame while dragging). */
  onChange: (fn: (c: Canvas) => Canvas) => void
  /** The view after a pan or zoom gesture ends. */
  onViewCommit: (view: Canvas['view']) => void
  ctx: CardCtx
  derived: Map<string, CardDerived>
  onConnect: (from: string, to: string, slot: string) => void
  onRemoveEdge: (id: string) => void
  empty?: ReactNode
  selectedIds?: string[]
  onSelect?: (ids: string[]) => void
  /** Rendered card heights by id, kept up to date here (new-card placement reads them). */
  heights: Map<string, number>
}

/** What the canvas hands each card for its header and ports. Stable per card. */
export interface CardUi {
  startDrag: (e: RPointerEvent) => void
  startConnect: (e: RPointerEvent) => void
}
/** While a connection is being dragged: can it land on each of this card's slots? */
export interface CardLink { fromHere: boolean; slots: Record<string, 'ok' | 'no'> }

type View = Canvas['view']
const clampZoom = (z: number) => Math.max(0.25, Math.min(2, z))
/** Below this zoom, cards draw as placeholders (no images, no controls). */
const LOD_ZOOM = 0.4
/** Heights before a card has been measured (generous, so culling errs towards mounting). */
const GUESS_H: Record<Card['kind'], number> = { prompt: 220, media: 320, processor: 360, output: 620 }
/** Test probe: CardShell renders (the render-count perf test reads it).
 * @public */
export const renderStats = { cards: 0 }

interface Cull { x0: number; y0: number; x1: number; y1: number; lod: boolean }

export default function ImageCanvas({ canvas, onChange, onViewCommit, ctx, derived, onConnect, onRemoveEdge, empty, selectedIds, onSelect, heights }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  // The live view. React only hears about it when a gesture ends (onViewCommit).
  const viewRef = useRef<View>(canvas.view)
  const canvasRef = useRef(canvas); canvasRef.current = canvas
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const onViewCommitRef = useRef(onViewCommit); onViewCommitRef.current = onViewCommit
  const onConnectRef = useRef(onConnect); onConnectRef.current = onConnect
  // The selection as of this pointer-down: the card's capture handler updates it before the
  // header's drag handler reads it, so a shift-click + drag moves the right set of cards.
  const selRef = useRef<string[]>(selectedIds ?? []); selRef.current = selectedIds ?? []
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect
  const select = (ids: string[]) => { selRef.current = ids; onSelectRef.current?.(ids) }
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds])
  const [box, setBox] = useState<{ a: Pt; b: Pt } | null>(null)
  // Holding Shift shows a pointer cursor over the canvas: shift-click adds/removes cards,
  // shift-drag box-selects. Not while typing (Shift there is just capitals).
  const [shift, setShift] = useState(false)
  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift' && !typing(e)) setShift(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShift(false) }
    const off = () => setShift(false)
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', off)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', off) }
  }, [])

  // ── view: ref + one style write per frame ──
  const size = () => { const r = ref.current?.getBoundingClientRect(); return { w: r?.width || 1200, h: r?.height || 800 } }
  const cullFor = (v: View): Cull => {
    const { w, h } = size()
    // The visible world rect plus half a screen on every side, so short pans don't remount.
    const vx0 = -v.x / v.zoom, vy0 = -v.y / v.zoom, vw = w / v.zoom, vh = h / v.zoom
    return { x0: vx0 - vw / 2, y0: vy0 - vh / 2, x1: vx0 + vw * 1.5, y1: vy0 + vh * 1.5, lod: v.zoom < LOD_ZOOM }
  }
  const [cull, setCull] = useState<Cull>(() => cullFor(canvas.view))
  const cullRef = useRef(cull); cullRef.current = cull
  const writeView = () => {
    const v = viewRef.current
    if (layerRef.current) layerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`
    const el = ref.current
    if (el) { el.style.backgroundPosition = `${v.x}px ${v.y}px`; el.style.backgroundSize = `calc(var(--canvas-grid) * ${v.zoom}) calc(var(--canvas-grid) * ${v.zoom})` }
    // Remount only when the viewport leaves the mounted area (or crosses the LOD zoom).
    const c = cullRef.current, { w, h } = size()
    const vx0 = -v.x / v.zoom, vy0 = -v.y / v.zoom
    if (vx0 < c.x0 || vy0 < c.y0 || vx0 + w / v.zoom > c.x1 || vy0 + h / v.zoom > c.y1 || (v.zoom < LOD_ZOOM) !== c.lod) {
      const n = cullFor(v); cullRef.current = n; setCull(n)
    }
  }
  const frame = useRef(0)
  const scheduleView = () => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; writeView() }) }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  // A view from outside (load, zoom buttons, the commit itself) wins.
  useLayoutEffect(() => {
    const v = canvas.view, cur = viewRef.current
    if (v.x !== cur.x || v.y !== cur.y || v.zoom !== cur.zoom) viewRef.current = v
    writeView()
  }, [canvas.view])
  const commitView = () => onViewCommitRef.current({ ...viewRef.current })
  const wheelCommit = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(wheelCommit.current), [])

  const toWorld = (clientX: number, clientY: number): Pt => {
    const r = ref.current!.getBoundingClientRect(), v = viewRef.current
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }
  }

  // One pointer-drag helper: window listeners until release, so fast moves never drop.
  const drag = (e: RPointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp?: (ev: PointerEvent) => void) => {
    e.preventDefault()
    let lx = e.clientX, ly = e.clientY
    const move = (ev: PointerEvent) => { onMove(ev.clientX - lx, ev.clientY - ly, ev); lx = ev.clientX; ly = ev.clientY }
    const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onUp?.(ev) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const heightOf = (k: Card) => heights.get(k.id) ?? GUESS_H[k.kind]

  const panStart = (e: RPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    if (e.shiftKey) {
      // Shift + drag on empty canvas: box-select, adding to what's already selected.
      const base = selRef.current, a = toWorld(e.clientX, e.clientY)
      setBox({ a, b: a })
      drag(e, (_dx, _dy, ev) => {
        const b = toWorld(ev.clientX, ev.clientY)
        setBox({ a, b })
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
        const hits = canvasRef.current.cards.filter((k) => k.x < x1 && k.x + CARD_W[k.kind] > x0 && k.y < y1 && k.y + heightOf(k) > y0).map((k) => k.id)
        const next = [...new Set([...base, ...hits])]
        if (next.length !== selRef.current.length || next.some((id, i) => id !== selRef.current[i])) select(next)
      }, () => setBox(null))
      return
    }
    if (selRef.current.length) select([])
    drag(e, (dx, dy) => { const v = viewRef.current; viewRef.current = { ...v, x: v.x + dx, y: v.y + dy }; scheduleView() },
      () => { cancelAnimationFrame(frame.current); frame.current = 0; writeView(); commitView() })
  }

  const onWheel = (e: RWheelEvent) => {
    const t = e.target as HTMLElement
    if (!(e.ctrlKey || e.metaKey) && t.closest('.img-nowheel')) return   // let text areas / galleries scroll
    const v = viewRef.current
    if (e.ctrlKey || e.metaKey) {
      const r = ref.current!.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const z = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.01))
      const k = z / v.zoom
      viewRef.current = { zoom: z, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k }
    } else viewRef.current = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }
    scheduleView()
    clearTimeout(wheelCommit.current)
    wheelCommit.current = setTimeout(commitView, 200)
  }

  // Trackpad pinch arrives as ctrl+wheel; stop Chromium zooming the whole page.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  // ── connecting ──
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const tempPath = useRef<SVGPathElement>(null)
  // Every slot's answer for this drag, computed once when it starts.
  const linkSlots = useMemo(() => {
    if (!linkFrom) return null
    const check = connectChecker(canvasRef.current, linkFrom)
    const out = new Map<string, CardLink>()
    for (const k of canvasRef.current.cards) {
      const slots: Record<string, 'ok' | 'no'> = {}
      const ids = k.kind === 'processor' ? k.data.slots : k.kind === 'output' ? ['in'] : []
      for (const s of ids) slots[s] = check(k.id, s).ok ? 'ok' : 'no'
      out.set(k.id, { fromHere: k.id === linkFrom, slots })
    }
    return out
  }, [linkFrom])

  // Stable per card id: the handlers read the latest state through refs.
  const uis = useRef(new Map<string, CardUi>())
  const uiFor = (id: string): CardUi => {
    let ui = uis.current.get(id)
    if (ui) return ui
    ui = {
      startDrag: (e) => {
        if (e.button !== 0) return
        // Dragging a selected card moves every selected card; a card just shift-clicked out of
        // the selection stays put.
        if (!selRef.current.includes(id)) return
        const ids = new Set(selRef.current)
        let px = 0, py = 0, raf = 0
        const flush = () => {
          raf = 0
          const dx = px, dy = py; px = 0; py = 0
          if (!dx && !dy) return
          const z = viewRef.current.zoom
          onChangeRef.current((c) => ({ ...c, cards: c.cards.map((k) => (ids.has(k.id) ? { ...k, x: k.x + dx / z, y: k.y + dy / z } : k)) }))
        }
        drag(e, (dx, dy) => { px += dx; py += dy; if (!raf) raf = requestAnimationFrame(flush) }, () => { cancelAnimationFrame(raf); flush() })
      },
      startConnect: (e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        const card = canvasRef.current.cards.find((k) => k.id === id)
        if (!card) return
        const a = outPort(card)
        let last = { clientX: e.clientX, clientY: e.clientY }
        const follow = (ev: { clientX: number; clientY: number }) => { last = ev; tempPath.current?.setAttribute('d', edgePath(a, toWorld(ev.clientX, ev.clientY))) }
        setLinkFrom(id)
        requestAnimationFrame(() => follow(last))   // the temp path exists after this render
        drag(e, (_dx, _dy, ev) => follow(ev), (ev) => {
          setLinkFrom(null)
          const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-slot]') as HTMLElement | null
          if (hit?.dataset.card && hit.dataset.slot) onConnectRef.current(id, hit.dataset.card, hit.dataset.slot)
        })
      }
    }
    uis.current.set(id, ui)
    return ui
  }

  // Forget handlers and heights of removed cards.
  useEffect(() => {
    if (uis.current.size <= canvas.cards.length && heights.size <= canvas.cards.length) return
    const ids = new Set(canvas.cards.map((k) => k.id))
    for (const id of [...uis.current.keys()]) if (!ids.has(id)) uis.current.delete(id)
    for (const id of [...heights.keys()]) if (!ids.has(id)) heights.delete(id)
  }, [canvas.cards, heights])

  // ── measured heights (culling, box-select, new-card placement) ──
  const ro = useMemo(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    for (const en of entries) { const id = (en.target as HTMLElement).dataset.cardId; if (id) heights.set(id, (en.target as HTMLElement).offsetHeight) }
  })), [heights])
  useEffect(() => () => ro?.disconnect(), [ro])

  // Clicking a card selects it; shift-click adds or removes it (one handler for all cards).
  const onCardPointerDown = useRef((id: string, e: RPointerEvent) => {
    // Pressing on a card that's already part of a multi-selection keeps the group (so it can
    // be dragged together) and narrows to this card only if you release without moving.
    const inField = !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
    const cur = selRef.current
    if (e.shiftKey && !inField) select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
    else if (!cur.includes(id)) select([id])
    else if (cur.length > 1) {
      const sx = e.clientX, sy = e.clientY
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', up, true)
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) select([id])
      }
      window.addEventListener('pointerup', up, true)
    }
    // Leave any text field you were typing in, unless you clicked into one: the header's
    // drag handler blocks the browser's own focus change, so Delete/⌘V would still go
    // to the old field instead of the selected card.
    const t = e.target as HTMLElement
    const ae = document.activeElement as HTMLElement | null
    if (ae && ae !== t && !t.closest('input, textarea, select') && ae.matches('input, textarea, select, [contenteditable="true"]')) ae.blur()
  }).current

  const visible = canvas.cards.filter((k) => k.x < cull.x1 && k.x + CARD_W[k.kind] > cull.x0 && k.y < cull.y1 && k.y + heightOf(k) > cull.y0)
  const v0 = viewRef.current

  return (
    <div ref={ref} className={`img-canvas${shift ? ' shift-select' : ''}`} onPointerDown={panStart} onWheel={onWheel}
      style={{ backgroundPosition: `${v0.x}px ${v0.y}px`, backgroundSize: `calc(var(--canvas-grid) * ${v0.zoom}) calc(var(--canvas-grid) * ${v0.zoom})` }}>
      {!canvas.cards.length && empty}
      <div ref={layerRef} className="img-layer" style={{ transform: `translate(${v0.x}px, ${v0.y}px) scale(${v0.zoom})` }}>
        <svg className="img-edges" width="1" height="1">
          <Edges canvas={canvas} onRemoveEdge={onRemoveEdge} />
          {linkFrom && <path ref={tempPath} className="img-edge-line img-edge-temp" />}
        </svg>
        {visible.map((k) => (
          <CardShell key={k.id} card={k} selected={selected.has(k.id)} d={derived.get(k.id)} ui={uiFor(k.id)} ctx={ctx}
            link={linkSlots?.get(k.id) ?? null} lod={cull.lod} height={heights.get(k.id)} ro={ro} onDown={onCardPointerDown} />
        ))}
        {box && (
          <div className="img-marquee" style={{ left: Math.min(box.a.x, box.b.x), top: Math.min(box.a.y, box.b.y), width: Math.abs(box.b.x - box.a.x), height: Math.abs(box.b.y - box.a.y), borderWidth: 1 / viewRef.current.zoom }} />
        )}
      </div>
    </div>
  )
}

// Edges re-render with the cards they connect; hovering one doesn't re-render the canvas.
const Edges = memo(function Edges({ canvas, onRemoveEdge }: { canvas: Canvas; onRemoveEdge: (id: string) => void }) {
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const byId = useMemo(() => new Map(canvas.cards.map((k) => [k.id, k])), [canvas.cards])
  return (
    <>
      {canvas.edges.map((e) => {
        const a = byId.get(e.from), b = byId.get(e.to)
        if (!a || !b) return null
        const d = edgePath(outPort(a), inPort(b, e.slot))
        return (
          <g key={e.id} className={`img-edge${hoverEdge === e.id ? ' hover' : ''}`}
            onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge((h) => (h === e.id ? null : h))}
            onClick={() => onRemoveEdge(e.id)}>
            <title>Click to disconnect</title>
            <path className="img-edge-hit" d={d} />
            <path className="img-edge-line" d={d} />
          </g>
        )
      })}
    </>
  )
})

interface ShellProps {
  card: Card; selected: boolean; d: CardDerived | undefined; ui: CardUi; ctx: CardCtx; link: CardLink | null
  lod: boolean; height: number | undefined; ro: ResizeObserver | null; onDown: (id: string, e: RPointerEvent) => void
}
const NO_VIEW: CardDerived = {}
// One card on the canvas. Memoized: it re-renders only when one of its own props changes.
const CardShell = memo(function CardShell({ card: k, selected, d, ui, ctx, link, lod, height, ro, onDown }: ShellProps) {
  renderStats.cards++
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => { const n = el.current; if (!n || !ro) return; ro.observe(n); return () => ro.unobserve(n) }, [ro])
  return (
    <div ref={el} data-card-id={k.id} className={`img-card img-card-${k.kind}${selected ? ' selected' : ''}${lod ? ' lod' : ''}`}
      style={{ left: k.x, top: k.y, width: CARD_W[k.kind], ...(lod && height ? { height } : {}) }}
      // Shift-click would otherwise extend the page's text selection across the cards.
      onMouseDownCapture={(e) => {
        if (e.shiftKey && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) { e.preventDefault(); window.getSelection()?.removeAllRanges() }
      }}
      onPointerDownCapture={(e) => onDown(k.id, e)}>
      <CardView card={k} ui={ui} ctx={ctx} d={d ?? NO_VIEW} link={link} lod={lod} />
    </div>
  )
})
