import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import { touchConversation } from './conversationsRepo'
import type { Message, NewMessageInput, ProviderId } from '../../shared/types'

interface Row {
  id: string; conversation_id: string; role: string; provider: string | null
  content: string; created_at: number; metadata: string | null
}
const toMsg = (r: Row): Message => ({
  id: r.id, conversationId: r.conversation_id, role: r.role as Message['role'],
  provider: r.provider as ProviderId | null, content: r.content, createdAt: r.created_at,
  metadata: r.metadata ? JSON.parse(r.metadata) : null
})

export function listMessages(conversationId: string): Message[] {
  return (getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(conversationId) as Row[]).map(toMsg)
}

// D-091: windowed reads, so a turn no longer loads the whole history several times.
export function countMessages(conversationId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conversationId) as { n: number }).n
}

/** Messages in transcript order starting at index `offset`; at most `limit` (all when omitted). */
export function listMessagesFrom(conversationId: string, offset: number, limit = -1): Message[] {
  return (getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?')
    .all(conversationId, limit, Math.max(0, offset)) as Row[]).map(toMsg)
}

// Audit #8 (2026-10-26): bounded reads for the CLI and the run log, which had gone back to
// loading whole transcripts (one of them once a second under `troupe status --wait`).

/** Messages from `since` on (created_at ≥ since), in order — uses idx_messages_conversation. */
export function listMessagesSince(conversationId: string, since: number): Message[] {
  return (getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? AND created_at >= ? ORDER BY created_at ASC, rowid ASC')
    .all(conversationId, since) as Row[]).map(toMsg)
}

/** The last `n` user/assistant messages, in order. */
export function lastChatMessages(conversationId: string, n: number): Message[] {
  return (getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(conversationId, Math.max(0, n)) as Row[]).map(toMsg).reverse()
}

/** How many user messages a chat has, and how many of them came from the command line. */
export function userMessageSources(conversationId: string): { total: number; cli: number } {
  const r = getDb().prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(json_extract(metadata, '$.via') = 'cli'), 0) AS cli FROM messages WHERE conversation_id = ? AND role = 'user'"
  ).get(conversationId) as { total: number; cli: number }
  return { total: r.total, cli: r.cli }
}

/** The newest message tagged as a Collab run's wrap-up (D-121), or null. */
export function collabWrapUpMessage(conversationId: string, runId: string): Message | null {
  const r = getDb().prepare(
    `SELECT * FROM messages WHERE conversation_id = ? AND json_extract(metadata, '$.collab.runId') = ? AND json_extract(metadata, '$.collab.role') = 'wrapup'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(conversationId, runId) as Row | undefined
  return r ? toMsg(r) : null
}

/** The latest user message and everything after it. With no user message: null + the whole transcript. */
export function lastUserTurn(conversationId: string): { user: Message | null; after: Message[] } {
  const db = getDb()
  const u = db.prepare(
    "SELECT rowid AS rid, * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1"
  ).get(conversationId) as (Row & { rid: number }) | undefined
  if (!u) return { user: null, after: listMessages(conversationId) }
  const after = (db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND rowid > ?))
     ORDER BY created_at ASC, rowid ASC`
  ).all(conversationId, u.created_at, u.created_at, u.rid) as Row[]).map(toMsg)
  return { user: toMsg(u), after }
}

export function getMessage(id: string): Message | null {
  const r = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
  return r ? toMsg(r) : null
}

export function appendMessage(input: NewMessageInput): Message {
  const id = randomUUID(); const now = Date.now()
  getDb().prepare(
    `INSERT INTO messages (id, conversation_id, role, provider, content, created_at, metadata)
     VALUES (@id, @conversationId, @role, @provider, @content, @now, @metadata)`
  ).run({
    id, conversationId: input.conversationId, role: input.role,
    provider: input.provider ?? null, content: input.content, now,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null
  })
  touchConversation(input.conversationId, input.provider ?? undefined)
  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row
  return toMsg(row)
}

// Delete a message and every message after it in the conversation (edit/regenerate).
export function deleteMessagesFrom(conversationId: string, messageId: string): void {
  const db = getDb()
  const msgs = listMessages(conversationId)
  const idx = msgs.findIndex((m) => m.id === messageId)
  if (idx < 0) return
  const ids = msgs.slice(idx).map((m) => m.id)
  const del = db.prepare('DELETE FROM messages WHERE id = ?')
  const tx = db.transaction(() => { for (const id of ids) del.run(id) })
  tx()
}
