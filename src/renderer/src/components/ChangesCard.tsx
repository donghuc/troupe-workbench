import { memo, useEffect, useState } from 'react'
import Icon from './Icon'
import { Button } from './ui/Button'
import { api } from '../api'
import { parseUnifiedDiff, totals, type TurnChanges, type DiffLine } from '../../../shared/changes'

// D-151: under the reply that ended a turn which changed project files. Glance: how many files
// and lines. Review: the files, and the before/after of the one you open. Restore: puts the files
// back from the restore point taken before the turn (asked first by the chat, which knows about
// later replies); afterwards the card says so and offers Undo restore.
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function DiffView({ messageId, path }: { messageId: string; path: string }) {
  const [state, setState] = useState<{ lines: DiffLine[]; binary: boolean; truncated: boolean } | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    api.changes.diff(messageId, path).then((d: string) => { if (alive) setState(parseUnifiedDiff(d)) }).catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [messageId, path])
  if (state === null) return <div className="chg-diff chg-diff-note">Loading…</div>
  if (state === 'error') return <div className="chg-diff chg-diff-note">Couldn’t read this change.</div>
  if (state.binary) return <div className="chg-diff chg-diff-note">Binary file — no line-by-line view.</div>
  if (!state.lines.length) return <div className="chg-diff chg-diff-note">No line changes (an empty file, or only its mode changed).</div>
  return (
    <div className="chg-diff" role="table" aria-label={`Changes in ${path}`}>
      {state.lines.map((l, i) => l.kind === 'hunk'
        ? <div key={i} className="chg-line chg-hunk">{l.text || '…'}</div>
        : <div key={i} className={`chg-line chg-${l.kind}`}>
            <span className="chg-no">{l.kind === 'del' ? l.oldNo : l.newNo}</span>
            <span className="chg-mark">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
            <span className="chg-text">{l.text || ' '}</span>
          </div>)}
      {state.truncated && <div className="chg-line chg-hunk">Longer than shown — open the file to see all of it.</div>}
    </div>
  )
}

interface Props {
  messageId: string
  changes: TurnChanges
  busy: boolean
  onRestore: (messageId: string) => void
  onUndo: (messageId: string) => Promise<void>
  onOpenFile?: (rel: string) => void
}

function ChangesCard({ messageId, changes, busy, onRestore, onUndo, onOpenFile }: Props) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const n = changes.files.length + (changes.more ?? 0)
  const t = totals(changes.files)
  const undo = async () => {
    setWorking(true)
    try { await onUndo(messageId) } finally { setWorking(false) }
  }
  if (changes.restored) {
    return (
      <div className="chg-card chg-restored">
        <Icon name="check" size="sm" />
        <span className="chg-title">Restored {n} file{n === 1 ? '' : 's'} to before this reply · {time(changes.restored.at)}</span>
        {changes.restored.failed?.length ? <span className="chg-warn">{changes.restored.failed.length} couldn’t be restored</span> : null}
        <span className="chg-spacer" />
        <Button size="sm" variant="ghost" disabled={busy || working} onClick={undo}>Undo restore</Button>
      </div>
    )
  }
  return (
    <div className={`chg-card${open ? ' open' : ''}`}>
      <div className="chg-head">
        <Icon name="file" size="sm" />
        <span className="chg-title">{n} file{n === 1 ? '' : 's'} changed</span>
        {t.add > 0 && <span className="chg-add">+{t.add}</span>}
        {t.del > 0 && <span className="chg-del">−{t.del}</span>}
        <span className="chg-spacer" />
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'Hide changes' : 'Review changes'}</Button>
        <Button size="sm" disabled={busy} title={busy ? 'Wait for the agent to finish' : undefined} onClick={() => onRestore(messageId)}><Icon name="undo" size="sm" /> Restore files to before this reply</Button>
      </div>
      {open && (
        <>
          <div className="chg-files">
            {changes.files.map((f) => (
              <div key={f.path} className="chg-file-wrap">
                <div className={`chg-file${file === f.path ? ' on' : ''}`}>
                  <button type="button" className="chg-file-toggle" onClick={() => setFile((p) => (p === f.path ? null : f.path))} aria-expanded={file === f.path}>
                    <Icon name={file === f.path ? 'chevron-down' : 'chevron-right'} size="xs" />
                    <span className="chg-path truncate" title={f.path}>{f.path}</span>
                  </button>
                  {f.status === 'A' ? <span className="chg-tag">new</span> : f.status === 'D' ? <span className="chg-tag">deleted</span> : null}
                  {f.binary ? <span className="chg-tag">binary</span> : <>{(f.add ?? 0) > 0 && <span className="chg-add">+{f.add}</span>}{(f.del ?? 0) > 0 && <span className="chg-del">−{f.del}</span>}</>}
                  {onOpenFile && f.status !== 'D' && <Button size="sm" variant="link" onClick={() => onOpenFile(f.path)}>Open</Button>}
                </div>
                {file === f.path && <DiffView messageId={messageId} path={f.path} />}
              </div>
            ))}
            {changes.more ? <div className="chg-more">and {changes.more} more file{changes.more === 1 ? '' : 's'}</div> : null}
          </div>
          {changes.overlap && <div className="chg-note">Another chat worked in this project at the same time, so some of these edits may be its.</div>}
          <div className="chg-note">Restore point saved before this reply · kept for 30 days, in Troupe’s own copy (not your git).</div>
        </>
      )}
    </div>
  )
}

export default memo(ChangesCard)
