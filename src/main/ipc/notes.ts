import { handle } from './handle'
import { listNotes, getNote, createNote, updateNote, deleteNote } from '../notes/notesRepo'
import type { NewNoteInput } from '../../shared/types'

export function registerNoteIpc(): void {
  handle('notes.list', () => listNotes())
  handle('notes.get', (_e, id: string) => getNote(id))
  handle('notes.create', (_e, input: NewNoteInput) => createNote(input))
  handle('notes.update', (_e, id: string, patch: { title?: string; body?: string }) => updateNote(id, patch))
  handle('notes.remove', (_e, id: string) => deleteNote(id))
}
