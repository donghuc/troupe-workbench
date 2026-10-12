import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { api } from '../api'
import type { SearchHit } from '../../../shared/types'

interface Props {
  onClose: () => void
  onOpen: (projectId: string, conversationId: string) => void
}

// ⌘K command palette: search conversation titles + message text across projects.
export default function SearchPalette({ onClose, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced search.
  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits([]); setSel(0); setLoading(false); return }
    setLoading(true)
    let alive = true
    const t = setTimeout(() => {
      api.conversations.search(q).then((r: SearchHit[]) => { if (alive) { setHits(r); setSel(0); setLoading(false) } })
        .catch(() => { if (alive) { setHits([]); setLoading(false) } })
    }, 140)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

  const choose = (h: SearchHit | undefined) => { if (h) onOpen(h.projectId, h.conversationId) }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hits[sel]) }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-card" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-input-row">
          <Icon name="search" size={16} className="palette-search-ico" />
          <input
            ref={inputRef} className="palette-input" value={query} placeholder="Search chats and messages…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="palette-results">
          {query.trim() && !loading && hits.length === 0 && <div className="palette-empty">No matches</div>}
          {hits.map((h, i) => (
            <button
              key={`${h.conversationId}-${i}`}
              className={`palette-row ${i === sel ? 'active' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(h)}
            >
              <Icon name={h.kind === 'message' ? 'file' : 'grid'} size={15} className="palette-row-ico" />
              <span className="palette-row-main">
                <span className="truncate palette-row-title">{h.title}</span>
                {h.snippet && <span className="truncate palette-row-snippet">{h.snippet}</span>}
              </span>
              <span className="truncate palette-row-project">{h.projectName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
