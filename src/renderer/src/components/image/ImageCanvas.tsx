import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { canConnect, type Canvas, type Card } from '../../../../shared/imageCanvas'
import { outPort, inPort, edgePath, CARD_W, type Pt } from './geometry'

// The open canvas (D-088): pan (drag the background, or two-finger scroll), zoom
// (⌘/ctrl + scroll or pinch), drag cards by their header, drag from a card's output
// port onto an input slot to connect, click an edge to remove it. No library — the
// cards have fixed geometry (geometry.ts), so edges are plain SVG paths.

interface Props {
  canvas: Canvas
  onChange: (fn: (c: Canvas) => Canvas) => void
  renderCard: (card: Card, ui: CardUi) => ReactNode
  onConnect: (from: string, to: string, slot: string) => void
  onRemoveEdge: (id: string) => void
  empty?: ReactNode
  selectedIds?: string[]
  onSelect?: (ids: string[]) => void
}

/** What the canvas hands each card for its header and ports. */
export interface CardUi {
  startDrag: (e: RPointerEvent) => void
  startConnect: (e: RPointerEvent) => void
  /** While a connection is being dragged: can it land on this slot? null = not connecting. */
  slotState: (slot: string) => 'ok' | 'no' | null
  connectingFromHere: boolean
}

const clampZoom = (z: number) => Math.max(0.25, Math.min(2, z))

export default function ImageCanvas({ canvas, onChange, renderCard, onConnect, onRemoveEdge, empty, selectedIds, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // The selection as of this pointer-down: the card's capture handler updates it before the
  // header's drag handler reads it, so a shift-click + drag moves the right set of cards.
  const selRef = useRef<string[]>(selectedIds ?? []); selRef.current = selectedIds ?? []
  const select = (ids: string[]) => { selRef.current = ids; onSelect?.(ids) }
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
  const [link, setLink] = useState<{ from: string; to: Pt } | null>(null)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const view = canvas.view

  const toWorld = (clientX: number, clientY: number): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom }
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
        const hits = canvas.cards.filter((k) => {
          const h = (ref.current?.querySelector(`[data-card-id="${k.id}"]`) as HTMLElement | null)?.offsetHeight ?? 120
          return k.x < x1 && k.x + CARD_W[k.kind] > x0 && k.y < y1 && k.y + h > y0
        }).map((k) => k.id)
        select([...new Set([...base, ...hits])])
      }, () => setBox(null))
      return
    }
    select([])
    drag(e, (dx, dy) => onChange((c) => ({ ...c, view: { ...c.view, x: c.view.x + dx, y: c.view.y + dy } })))
  }

  const onWheel = (e: RWheelEvent) => {
    const t = e.target as HTMLElement
    if (!(e.ctrlKey || e.metaKey) && t.closest('.img-nowheel')) return   // let text areas / galleries scroll
    if (e.ctrlKey || e.metaKey) {
      const r = ref.current!.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      onChange((c) => {
        const z = clampZoom(c.view.zoom * Math.exp(-e.deltaY * 0.01))
        const k = z / c.view.zoom
        return { ...c, view: { zoom: z, x: mx - (mx - c.view.x) * k, y: my - (my - c.view.y) * k } }
      })
    } else {
      onChange((c) => ({ ...c, view: { ...c.view, x: c.view.x - e.deltaX, y: c.view.y - e.deltaY } }))
    }
  }

  // Trackpad pinch arrives as ctrl+wheel; stop Chromium zooming the whole page.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  const uiFor = (card: Card): CardUi => ({
    startDrag: (e) => {
      if (e.button !== 0) return
      // Dragging a selected card moves every selected card; a card just shift-clicked out of
      // the selection stays put.
      if (!selRef.current.includes(card.id)) return
      const ids = new Set(selRef.current)
      drag(e, (dx, dy) => onChange((c) => ({ ...c, cards: c.cards.map((k) => (ids.has(k.id) ? { ...k, x: k.x + dx / c.view.zoom, y: k.y + dy / c.view.zoom } : k)) })))
    },
    startConnect: (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      setLink({ from: card.id, to: toWorld(e.clientX, e.clientY) })
      drag(e, (_dx, _dy, ev) => setLink({ from: card.id, to: toWorld(ev.clientX, ev.clientY) }), (ev) => {
        setLink(null)
        const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-slot]') as HTMLElement | null
        if (hit?.dataset.card && hit.dataset.slot) onConnect(card.id, hit.dataset.card, hit.dataset.slot)
      })
    },
    slotState: (slot) => (link ? (canConnect(canvas, link.from, card.id, slot).ok ? 'ok' : 'no') : null),
    connectingFromHere: link?.from === card.id
  })

  const byId = new Map(canvas.cards.map((k) => [k.id, k]))
  const linkFrom = link && byId.get(link.from)

  return (
    <div ref={ref} className={`img-canvas${shift ? ' shift-select' : ''}`} onPointerDown={panStart} onWheel={onWheel}
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }}>
      {!canvas.cards.length && empty}
      <div className="img-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="img-edges" width="1" height="1">
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
          {linkFrom && link && <path className="img-edge-line img-edge-temp" d={edgePath(outPort(linkFrom), link.to)} />}
        </svg>
        {canvas.cards.map((k) => (
          <div key={k.id} data-card-id={k.id} className={`img-card img-card-${k.kind}${selectedIds?.includes(k.id) ? ' selected' : ''}`} style={{ left: k.x, top: k.y, width: CARD_W[k.kind] }}
            // Shift-click would otherwise extend the page's text selection across the cards.
            onMouseDownCapture={(e) => {
              if (e.shiftKey && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) { e.preventDefault(); window.getSelection()?.removeAllRanges() }
            }}
            onPointerDownCapture={(e) => {
              // Click selects this card; shift-click adds or removes it. Pressing on a card that's
              // already part of a multi-selection keeps the group (so it can be dragged together)
              // and narrows to this card only if you release without moving.
              const inField = !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
              const cur = selRef.current
              if (e.shiftKey && !inField) select(cur.includes(k.id) ? cur.filter((x) => x !== k.id) : [...cur, k.id])
              else if (!cur.includes(k.id)) select([k.id])
              else if (cur.length > 1) {
                const sx = e.clientX, sy = e.clientY
                const up = (ev: PointerEvent) => {
                  window.removeEventListener('pointerup', up, true)
                  if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) select([k.id])
                }
                window.addEventListener('pointerup', up, true)
              }
              // Leave any text field you were typing in, unless you clicked into one: the header's
              // drag handler blocks the browser's own focus change, so Delete/⌘V would still go
              // to the old field instead of the selected card.
              const t = e.target as HTMLElement
              const ae = document.activeElement as HTMLElement | null
              if (ae && ae !== t && !t.closest('input, textarea, select') && ae.matches('input, textarea, select, [contenteditable="true"]')) ae.blur()
            }}>
            {renderCard(k, uiFor(k))}
          </div>
        ))}
        {box && (
          <div className="img-marquee" style={{ left: Math.min(box.a.x, box.b.x), top: Math.min(box.a.y, box.b.y), width: Math.abs(box.b.x - box.a.x), height: Math.abs(box.b.y - box.a.y), borderWidth: 1 / view.zoom }} />
        )}
      </div>
    </div>
  )
}
