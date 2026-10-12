import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import type { CanvasIndex } from '../../../../shared/imageCanvas'

// Canvas tabs in the Image Creation header (D-102). Click to switch, double-click to rename,
// ⋮ for Rename · Duplicate · Clear canvas · Delete. "+" adds a canvas after the active one.
interface Props {
  index: CanvasIndex
  busy: ReadonlySet<string>          // canvases with a run in progress (spinner dot)
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onClear: (id: string) => void
  onDelete: (id: string) => void
}

export default function CanvasTabs({ index, busy, onSelect, onCreate, onRename, onDuplicate, onClear, onDelete }: Props) {
  // The tab strip scrolls sideways, which would clip an absolutely placed menu — so the menu
  // is fixed-positioned under the ⋮ button.
  const [menu, setMenu] = useState<string | null>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const activeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [index.active, index.tabs.length])
  const startRename = (id: string, name: string) => { setMenu(null); setEditing(id); setDraft(name) }
  const commit = () => { if (editing && draft.trim()) onRename(editing, draft); setEditing(null) }
  return (
    <div className="img-tabs" role="tablist" aria-label="Canvases">
      <div className="img-tabs-scroll">
        {index.tabs.map((t) => {
          const on = t.id === index.active
          return (
            <div key={t.id} ref={on ? activeRef : undefined} role="tab" aria-selected={on}
              className={`img-tab${on ? ' active' : ''}${menu === t.id ? ' menu-open' : ''}`}
              onClick={() => { if (!on && editing !== t.id) onSelect(t.id) }}
              onDoubleClick={() => startRename(t.id, t.name)} title={on ? `${t.name} — double-click to rename` : t.name}>
              {busy.has(t.id) && <span className="activity-spinner img-tab-busy" title="Generating images…" />}
              {editing === t.id ? (
                <input className="img-tab-input" autoFocus value={draft} maxLength={60} onFocus={(e) => e.target.select()}
                  onChange={(e) => setDraft(e.target.value)} onBlur={commit} onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); e.stopPropagation() }} />
              ) : (
                <span className="img-tab-name truncate">{t.name}</span>
              )}
              <button className="img-tab-more" title="Canvas options" aria-label={`Options for ${t.name}`}
                onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenuAt({ x: r.left, y: r.bottom + 4 }); setMenu(menu === t.id ? null : t.id) }}><Icon name="more-vertical" size={14} /></button>
              {menu === t.id && (
                <>
                  <div className="menu-backdrop" onClick={(e) => { e.stopPropagation(); setMenu(null) }} />
                  <div className="conv-menu img-tab-menu" style={{ left: menuAt.x, top: menuAt.y }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => startRename(t.id, t.name)}>Rename</button>
                    <button onClick={() => { setMenu(null); onDuplicate(t.id) }}>Duplicate</button>
                    <button onClick={() => { setMenu(null); onClear(t.id) }}>Clear canvas</button>
                    <button className="danger" onClick={() => { setMenu(null); onDelete(t.id) }}>Delete</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      <button className="icon-btn img-tab-add" title="New canvas" aria-label="New canvas" onClick={onCreate}><Icon name="plus" size={15} /></button>
    </div>
  )
}
