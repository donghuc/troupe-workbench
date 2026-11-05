import { useEffect, useState, type DragEvent } from 'react'
import Icon, { type IconName } from '../Icon'
import type { CardKind } from '../../../../shared/imageCanvas'
import { IconButton } from '../ui/Button'

// The "Add card" panel pinned to the canvas's top-left (Hien, 2026-10-12): moves card
// creation out of the header, which is kept free for canvas tabs. Styled as a card itself.
// Click a tile to add that card in the middle of the view, or drag it onto the canvas to
// place it where you drop it. Image and Animate are both run cards (D-148: Motion merged in).
export type PaletteKind = CardKind | 'animate'
export const CARD_DRAG_TYPE = 'application/x-troupe-image-card'
/** Single-key shortcuts that add a card (ignored while typing). R still adds an Image card. */
export const CARD_SHORTCUTS: Record<string, PaletteKind> = { p: 'prompt', m: 'media', i: 'processor', r: 'processor', a: 'animate', o: 'output' }
const TILES: { kind: PaletteKind; key: string; label: string; icon: IconName; hint: string }[] = [
  { kind: 'prompt', key: 'P', label: 'Prompt', icon: 'edit', hint: 'Text that describes the image or animation' },
  { kind: 'media', key: 'M', label: 'Media', icon: 'image', hint: 'Images, SVG or video to use as references' },
  { kind: 'processor', key: 'I', label: 'Image', icon: 'flash', hint: 'Runs an agent that makes images' },
  { kind: 'animate', key: 'A', label: 'Animate', icon: 'film', hint: 'Runs an agent that makes a Lottie animation' },
  { kind: 'output', key: 'O', label: 'Output', icon: 'grid', hint: 'Shows the results: images, or a player for animations' }
]
const COLLAPSED_KEY = 'image.palette.collapsed'

export default function CardPalette({ onAdd }: { onAdd: (kind: PaletteKind) => void }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* storage unavailable */ } }, [collapsed])
  const onDragStart = (e: DragEvent, kind: PaletteKind) => {
    e.dataTransfer.setData(CARD_DRAG_TYPE, kind)
    e.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div className={`img-palette${collapsed ? ' collapsed' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="img-card-head img-palette-head">
        <span className="img-kind">Add card</span>
        <span className="img-card-head-extra" />
        <IconButton className="img-card-x" title={collapsed ? 'Show cards' : 'Hide cards'} aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>
          <Icon name="chevron-down" size="sm" className={collapsed ? 'rot-90' : ''} />
        </IconButton>
      </div>
      {!collapsed && (
        <div className="img-palette-grid">
          {TILES.map(({ kind, key, label, icon, hint }) => (
            <button key={kind} className={`img-palette-tile img-kind-tint-${kind === 'animate' ? 'processor' : kind}`} draggable
              title={`${hint} — click or press ${key} to add, or drag onto the canvas`}
              onDragStart={(e) => onDragStart(e, kind)} onClick={() => onAdd(kind)}>
              <kbd className="img-palette-key">{key}</kbd>
              <Icon name={icon} size="nav" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
