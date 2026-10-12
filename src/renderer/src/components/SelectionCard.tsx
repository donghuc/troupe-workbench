// A selected passage on a sent message (D-066): the passage with a little faded text
// around it, and a source tag that opens the file it came from.
import { sourceLabel, type SelectionItem } from '../../../shared/selections'

export default function SelectionCard({ sel, onOpen }: { sel: SelectionItem; onOpen?: (rel: string) => void }) {
  const path = sel.source?.path
  return (
    <div className="sel-card">
      <div className="sel-card-quote">
        {sel.before && <span className="sel-card-ctx">…{sel.before} </span>}
        <span className="sel-card-text">{sel.text}</span>
        {sel.after && <span className="sel-card-ctx"> {sel.after}…</span>}
      </div>
      {sel.source && (
        path && onOpen
          ? <button className="sel-card-src" onClick={() => onOpen(path)} title={`Open ${path}`}>{sourceLabel(sel.source)}</button>
          : <span className="sel-card-src static">{sourceLabel(sel.source)}</span>
      )}
    </div>
  )
}
