import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import type { SessionSnapshot, ProviderId } from '../../shared/types'

interface Row {
  id: string; conversation_id: string; content: string
  through_count: number; provider_id: string | null; created_at: number
}
const toSnap = (r: Row): SessionSnapshot => ({
  id: r.id, conversationId: r.conversation_id, content: r.content,
  throughCount: r.through_count, providerId: r.provider_id as ProviderId | null, createdAt: r.created_at
})

export function getLatestSnapshot(conversationId: string): SessionSnapshot | null {
  const r = getDb()
    .prepare('SELECT * FROM session_snapshots WHERE conversation_id = ? ORDER BY through_count DESC, created_at DESC LIMIT 1')
    .get(conversationId) as Row | undefined
  return r ? toSnap(r) : null
}

export function insertSnapshot(conversationId: string, content: string, throughCount: number, providerId: ProviderId | null): SessionSnapshot {
  const id = randomUUID()
  getDb().prepare(
    `INSERT INTO session_snapshots (id, conversation_id, content, through_count, provider_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, content, throughCount, providerId, Date.now())
  return getLatestSnapshot(conversationId)!
}
