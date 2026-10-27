import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import type { Conversation, ProviderId, RecentConversation, SearchHit } from '../../shared/types'

interface Row {
  id: string; project_id: string; title: string; provider: string
  model: string | null; permission_mode: string | null; pinned: number; created_at: number; updated_at: number
}
const toConv = (r: Row): Conversation => ({
  id: r.id, projectId: r.project_id, title: r.title, provider: r.provider as ProviderId,
  model: r.model, permissionMode: r.permission_mode ?? null, pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at
})

export function listConversations(projectId: string): Conversation[] {
  return (getDb()
    .prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC')
    .all(projectId) as Row[]).map(toConv)
}

/** Chats per project in one query (audit #8: was one full list per project). */
export function conversationCounts(): Map<string, number> {
  const rows = getDb().prepare('SELECT project_id, COUNT(*) AS n FROM conversations GROUP BY project_id').all() as { project_id: string; n: number }[]
  return new Map(rows.map((r) => [r.project_id, r.n]))
}

export function listRecentConversations(limit = 12): RecentConversation[] {
  const rows = getDb().prepare(
    `SELECT c.*, p.name AS project_name FROM conversations c
     JOIN projects p ON p.id = c.project_id
     ORDER BY c.updated_at DESC LIMIT ?`
  ).all(limit) as (Row & { project_name: string })[]
  return rows.map((r) => ({ ...toConv(r), projectName: r.project_name }))
}

export function getConversation(id: string): Conversation | null {
  const r = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Row | undefined
  return r ? toConv(r) : null
}

export function createConversation(projectId: string, title: string, provider: ProviderId): Conversation {
  const now = Date.now(); const id = randomUUID()
  getDb().prepare(
    `INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title.trim() || 'New conversation', provider, now, now)
  return getConversation(id)!
}

export function renameConversation(id: string, title: string): Conversation {
  getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title.trim(), Date.now(), id)
  return getConversation(id)!
}

export function touchConversation(id: string, provider?: ProviderId): void {
  if (provider) getDb().prepare('UPDATE conversations SET updated_at = ?, provider = ? WHERE id = ?').run(Date.now(), provider, id)
  else getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function setConversationModel(id: string, model: string | null): void {
  getDb().prepare('UPDATE conversations SET model = ? WHERE id = ?').run(model, id)
}

export function setConversationPermissionMode(id: string, mode: string | null): void {
  getDb().prepare('UPDATE conversations SET permission_mode = ? WHERE id = ?').run(mode, id)
}

export function setConversationPinned(id: string, pinned: boolean): void {
  getDb().prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

// Copy a conversation (optionally only up to and including a message) into a new one.
export function branchConversation(convId: string, throughMessageId: string | null): Conversation {
  const src = getConversation(convId)
  if (!src) throw new Error('conversation not found')
  const all = getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC').all(convId) as Array<{ role: string; provider: string | null; content: string; metadata: string | null; id: string }>
  let slice = all
  if (throughMessageId) {
    const idx = all.findIndex((m) => m.id === throughMessageId)
    if (idx >= 0) slice = all.slice(0, idx + 1)
  }
  const title = throughMessageId ? `${src.title} (branch)` : `${src.title} (copy)`
  const conv = createConversation(src.projectId, title, src.provider)
  setConversationModel(conv.id, src.model)
  const ins = getDb().prepare(`INSERT INTO messages (id, conversation_id, role, provider, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const now = Date.now()
  const tx = getDb().transaction(() => {
    slice.forEach((m, i) => ins.run(randomUUID(), conv.id, m.role, m.provider, m.content, now + i, m.metadata))
  })
  tx()
  return getConversation(conv.id)!
}

/**
 * D-095: the FTS5 query for what the user typed — every word must appear as a word
 * prefix, in any order ("auth flow" finds "flow for authentication"). Null when the
 * query has no letters or digits (e.g. "->"), which falls back to a substring scan.
 */
export function ftsQuery(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}_]+/gu)
  return words?.length ? words.map((w) => `"${w}"*`).join(' ') : null
}

// Cross-project search of conversation titles + message contents.
export function searchAll(query: string, limit = 20): SearchHit[] {
  const q = `%${query.replace(/[%_]/g, (c) => '\\' + c)}%`
  const db = getDb()
  const fts = ftsQuery(query)
  const titleRows = db.prepare(
    `SELECT c.id, c.project_id AS pid, c.title, p.name AS pname
     FROM conversations c JOIN projects p ON p.id = c.project_id
     WHERE c.title LIKE ? ESCAPE '\\' ORDER BY c.updated_at DESC LIMIT ?`
  ).all(q, limit) as Array<{ id: string; pid: string; title: string; pname: string }>
  const hits: SearchHit[] = []
  for (const r of titleRows) hits.push({ conversationId: r.id, projectId: r.pid, projectName: r.pname, title: r.title, snippet: '', kind: 'title' })
  const seen = new Set(titleRows.map((r) => r.id))
  const add = (cid: string, pid: string, pname: string, title: string, snippet: string) => {
    if (seen.has(cid) || hits.length >= limit) return
    seen.add(cid)
    hits.push({ conversationId: cid, projectId: pid, projectName: pname, title, snippet, kind: 'message' })
  }
  if (fts) {
    // One hit per conversation: its newest matching message; newest conversations first.
    // Then snippets for just those rows.
    const rows = db.prepare(
      `WITH matched AS (
         SELECT m.conversation_id AS cid, m.rowid AS rid, m.created_at AS at,
                ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC, m.rowid DESC) AS rn
         FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?)
       SELECT x.cid, x.rid, c.project_id AS pid, c.title, p.name AS pname
       FROM matched x JOIN conversations c ON c.id = x.cid JOIN projects p ON p.id = c.project_id
       WHERE x.rn = 1 ORDER BY x.at DESC LIMIT ?`
    ).all(fts, limit) as Array<{ cid: string; rid: number; pid: string; title: string; pname: string }>
    // CAST: a JS number binds as REAL, and FTS5 then ignores the rowid filter (returns every match).
    const snip = db.prepare(`SELECT snippet(messages_fts, 0, '', '', '…', 14) AS s FROM messages_fts WHERE messages_fts MATCH ? AND rowid = CAST(? AS INTEGER)`)
    for (const r of rows) {
      const s = (snip.get(fts, r.rid) as { s: string } | undefined)?.s ?? ''
      add(r.cid, r.pid, r.pname, r.title, s.replace(/\s+/g, ' ').trim())
    }
    // Words match by prefix; when that finds no message at all, fall back to the old
    // substring scan so mid-word ("Config" in codexConfig) and CJK queries still work (D-100).
    if (rows.length) return hits
  }
  const msgRows = db.prepare(
    `SELECT m.conversation_id AS cid, m.content, c.project_id AS pid, c.title, p.name AS pname, MAX(m.created_at) AS at
     FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN projects p ON p.id = c.project_id
     WHERE m.content LIKE ? ESCAPE '\\' GROUP BY m.conversation_id ORDER BY at DESC LIMIT ?`
  ).all(q, limit) as Array<{ cid: string; content: string; pid: string; title: string; pname: string }>
  for (const r of msgRows) {
    const i = r.content.toLowerCase().indexOf(query.toLowerCase())
    const start = Math.max(0, i - 40)
    add(r.cid, r.pid, r.pname, r.title, (start > 0 ? '…' : '') + r.content.slice(start, i + query.length + 40).replace(/\s+/g, ' ').trim() + '…')
  }
  return hits
}
