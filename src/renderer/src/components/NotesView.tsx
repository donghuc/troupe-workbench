import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import MasterDetail from './MasterDetail'
import { api } from '../api'
import type { Note, Project } from '../../../shared/types'

interface Props {
  projects: Project[]
  onNoteToChat: (note: Note, projectId: string) => void
  onNoteToProject: (note: Note) => void
}

const noteTitle = (n: { title: string; body: string }) =>
  n.title.trim() || n.body.trim().split('\n')[0].slice(0, 60) || 'Untitled note'
const snippet = (n: Note) => n.body.trim().replace(/\s+/g, ' ').slice(0, 80)
const when = (t: number) => {
  const d = Math.floor((Date.now() - t) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return new Date(t).toLocaleDateString()
}

export default function NotesView({ projects, onNoteToChat, onNoteToProject }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pickChat, setPickChat] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = async (selectFirst = false): Promise<void> => {
    const list = await api.notes.list()
    setNotes(list)
    if (selectFirst && list.length && !selId) { setSelId(list[0].id); setTitle(list[0].title); setBody(list[0].body) }
  }
  useEffect(() => { load(true) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const doSave = async (id: string, t: string, b: string): Promise<void> => {
    await api.notes.update(id, { title: t, body: b })
    setNotes((cur) => cur.map((n) => (n.id === id ? { ...n, title: t, body: b, updatedAt: Date.now() } : n)))
  }
  const flushSave = (): void => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (selId) void doSave(selId, title, body)
  }
  const scheduleSave = (t: string, b: string): void => {
    if (!selId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void doSave(selId, t, b) }, 500)
  }

  const select = (n: Note): void => { flushSave(); setPickChat(false); setMenuOpen(false); setSelId(n.id); setTitle(n.title); setBody(n.body) }
  const newNote = async (): Promise<void> => {
    flushSave(); setPickChat(false); setMenuOpen(false)
    const n = await api.notes.create({})
    setNotes((cur) => [n, ...cur]); setSelId(n.id); setTitle(''); setBody('')
  }
  const del = async (n: Note): Promise<void> => {
    if (!confirm('Delete this note?')) return
    await api.notes.remove(n.id)
    if (selId === n.id) { setSelId(null); setTitle(''); setBody('') }
    await load()
  }
  const onTitle = (v: string): void => { setTitle(v); scheduleSave(v, body) }
  const onBody = (v: string): void => { setBody(v); scheduleSave(title, v) }

  const selected = notes.find((n) => n.id === selId) ?? null
  const toChat = (projectId: string): void => { if (!selected) return; flushSave(); onNoteToChat({ ...selected, title, body }, projectId) }
  const toProject = (): void => { if (!selected) return; flushSave(); onNoteToProject({ ...selected, title, body }) }

  return (
    <MasterDetail
      contentWhite
      listHeader={<button className="btn btn-sm" onClick={newNote}><Icon name="plus" size={14} />New note</button>}
      list={
        <>
          {notes.length === 0 && <div className="sidebar-empty">No notes yet.</div>}
          {notes.map((n) => (
            <div key={n.id} className={`md-row ${selId === n.id ? 'active' : ''}`} onClick={() => select(n)}>
              <div className="md-row-main">
                <div className="truncate md-row-title">{noteTitle(n)}</div>
                <div className="truncate md-row-sub">{snippet(n) || 'Empty note'}</div>
              </div>
              <span className="note-row-time">{when(n.updatedAt)}</span>
            </div>
          ))}
        </>
      }
      header={selected && (
        <>
          <span className="md-head-title truncate">{title.trim() || noteTitle({ title, body })}</span>
          <span className="md-head-spacer" />
          <div className="note-tochat">
            <button className="btn btn-sm" disabled={!projects.length} onClick={() => { setMenuOpen(false); setPickChat((v) => !v) }}>Turn into chat ▾</button>
            {pickChat && (
              <>
                <div className="md-menu-backdrop" onClick={() => setPickChat(false)} />
                <div className="conv-menu note-proj-menu">
                  {projects.length === 0 && <div className="sidebar-empty">No projects yet</div>}
                  {projects.map((p) => (
                    <button key={p.id} onClick={() => { setPickChat(false); toChat(p.id) }}>{p.name}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="md-head-menu">
            <button className="icon-btn" title="More" aria-expanded={menuOpen} onClick={() => { setPickChat(false); setMenuOpen((v) => !v) }}><Icon name="more-vertical" size={16} /></button>
            {menuOpen && (
              <>
                <div className="md-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="conv-menu">
                  <button onClick={() => { setMenuOpen(false); toProject() }}>Turn into project</button>
                  <button className="danger" onClick={() => { setMenuOpen(false); del(selected) }}>Delete</button>
                </div>
              </>
            )}
          </span>
        </>
      )}
    >
      {!selected ? (
        <div className="md-placeholder">Select a note, or capture a new one.</div>
      ) : (
        <div className="note-editor">
          <input className="note-title-input" value={title} placeholder="Title" onChange={(e) => onTitle(e.target.value)} onBlur={flushSave} />
          <textarea className="note-body-input" value={body} placeholder="Paste or write your note…" autoFocus onChange={(e) => onBody(e.target.value)} onBlur={flushSave} />
        </div>
      )}
    </MasterDetail>
  )
}
