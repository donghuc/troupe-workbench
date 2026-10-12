import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import type { Note, NewNoteInput } from '../../shared/types'

interface Row { id: string; title: string; body: string; created_at: number; updated_at: number }
const toNote = (r: Row): Note => ({ id: r.id, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at })

export function listNotes(): Note[] {
  return (getDb().prepare('SELECT * FROM notes ORDER BY updated_at DESC').all() as Row[]).map(toNote)
}
export function getNote(id: string): Note | null {
  const r = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
  return r ? toNote(r) : null
}
export function createNote(input: NewNoteInput = {}): Note {
  const id = randomUUID(); const now = Date.now()
  getDb().prepare('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, input.title ?? '', input.body ?? '', now, now)
  return getNote(id)!
}
export function updateNote(id: string, patch: { title?: string; body?: string }): Note {
  const cur = getNote(id); if (!cur) throw new Error('note not found')
  getDb().prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(patch.title ?? cur.title, patch.body ?? cur.body, Date.now(), id)
  return getNote(id)!
}
export function deleteNote(id: string): void {
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
}
