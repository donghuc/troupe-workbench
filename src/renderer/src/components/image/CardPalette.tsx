import { useEffect, useState, type DragEvent } from 'react'
import Icon, { type IconName } from '../Icon'
import { CARD_LABEL, type CardKind } from '../../../../shared/imageCanvas'

// The "Add card" panel pinned to the canvas's top-left (Hien, 2026-10-12): moves card
// creation out of the header, which is kept free for canvas tabs. Styled as a card itself.
// Click a tile to add that card in the middle of the view, or drag it onto the canvas to
// place it where you drop it.
export const CARD_DRAG_TYPE = 'application/x-troupe-image-card'
/** Single-key shortcuts that add a card (ignored while typing). R = Processor ("run"). */
export const CARD_SHORTCUTS: Record<string, CardKind> = { p: 'prompt', m: 'media', r: 'processor', o: 'output' }
const KEY_OF: Record<CardKind, string> = { prompt: 'P', media: 'M', processor: 'R', output: 'O' }
const KINDS: { kind: CardKind; icon: IconName; hint: string }[] = [
  { kind: 'prompt', icon: 'edit', hint: 'Text that describes the image' },
  { kind: 'media', icon: 'image', hint: 'Reference images' },
  { kind: 'processor', icon: 'flash', hint: 'Runs an agent on its inputs' },
  { kind: 'output', icon: 'grid', hint: 'Shows the results, with versions' }
]
const COLLAPSED_KEY = 'image.palette.collapsed'

export default function CardPalette({ onAdd }: { onAdd: (kind: CardKind) => void }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* storage unavailable */ } }, [collapsed])
  const onDragStart = (e: DragEvent, kind: CardKind) => {
    e.dataTransfer.setData(CARD_DRAG_TYPE, kind)
    e.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div className={`img-palette${collapsed ? ' collapsed' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="img-card-head img-palette-head">
        <span className="img-kind">Add card</span>
        <span className="img-card-head-extra" />
        <button className="icon-btn img-card-x" title={collapsed ? 'Show cards' : 'Hide cards'} aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>
          <Icon name="chevron-down" size={14} className={collapsed ? 'rot-90' : ''} />
        </button>
      </div>
      {!collapsed && (
        <div className="img-palette-grid">
          {KINDS.map(({ kind, icon, hint }) => (
            <button key={kind} className={`img-palette-tile img-kind-tint-${kind}`} draggable
              title={`${hint} — click or press ${KEY_OF[kind]} to add, or drag onto the canvas`}
              onDragStart={(e) => onDragStart(e, kind)} onClick={() => onAdd(kind)}>
              <kbd className="img-palette-key">{KEY_OF[kind]}</kbd>
              <Icon name={icon} size={18} />
              <span>{CARD_LABEL[kind]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
