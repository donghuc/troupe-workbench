import type { SelectionItem } from '../../shared/selections'
import type { PendingAttachment } from './attachments'

// Per-conversation unsent-input drafts, so switching threads doesn't lose typing.
// localStorage-backed (survives restart); safe no-ops if storage is unavailable.
const key = (id: string) => `draft:${id}`

export function getDraft(id: string): string {
  try { return localStorage.getItem(key(id)) ?? '' } catch { return '' }
}
export function setDraft(id: string, text: string): void {
  try {
    if (text) localStorage.setItem(key(id), text)
    else localStorage.removeItem(key(id))
  } catch { /* ignore */ }
}

// Selected passages waiting in the composer (D-065), kept per conversation like text.
const selKey = (id: string) => `draftsel:${id}`
export function getDraftSelections(id: string): SelectionItem[] {
  try { const v = JSON.parse(localStorage.getItem(selKey(id)) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
export function setDraftSelections(id: string, sels: SelectionItem[]): void {
  try {
    if (sels.length) localStorage.setItem(selKey(id), JSON.stringify(sels))
    else localStorage.removeItem(selKey(id))
  } catch { /* ignore */ }
}

// Attachments waiting in the composer, per conversation (Hien, 2026-10-08: an attached image
// vanished after visiting Image and coming back — the composer unmounts on every view switch).
// Kept in memory, not localStorage: a dropped/pasted image is a File object that can't be
// serialised, so they survive switching views and chats but not an app restart.
const attachmentDrafts = new Map<string, PendingAttachment[]>()
export const getDraftAttachments = (id: string): PendingAttachment[] => attachmentDrafts.get(id) ?? []
export function setDraftAttachments(id: string, list: PendingAttachment[]): void {
  if (list.length) attachmentDrafts.set(id, list)
  else attachmentDrafts.delete(id)
}
