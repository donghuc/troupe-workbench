import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestDb, seedConversation, testDb } from '../testing/memoryDb'

vi.mock('../database/db', () => ({ getDb: () => testDb() }))
const { searchAll, ftsQuery, deleteConversation } = await import('./conversationsRepo')
const { appendMessage, deleteMessagesFrom } = await import('./messagesRepo')

let t = 0
const msg = (cid: string, content: string) => {
  const m = appendMessage({ conversationId: cid, role: 'assistant', provider: 'codex', content })
  testDb().prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(++t, m.id)   // deterministic order
  return m
}

describe('ftsQuery', () => {
  it('turns words into prefix terms', () => {
    expect(ftsQuery('auth flow')).toBe('"auth"* "flow"*')
    expect(ftsQuery('  Việt-Nam  ')).toBe('"Việt"* "Nam"*')
    expect(ftsQuery('"; DROP TABLE x --')).toBe('"DROP"* "TABLE"* "x"*')
    expect(ftsQuery('->')).toBeNull()
    expect(ftsQuery('')).toBeNull()
  })
})

describe('searchAll with FTS5 (D-095)', () => {
  beforeEach(() => { resetTestDb(); t = 0; seedConversation('c1'); seedConversation('c2'); seedConversation('c3') })

  it('finds words in any order, by prefix, case- and diacritic-insensitive', () => {
    msg('c1', 'We should design the authentication flow next week.')
    msg('c2', 'Kế hoạch cho Việt Nam')
    expect(searchAll('flow AUTH').map((h) => h.conversationId)).toEqual(['c1'])
    expect(searchAll('authenticat').map((h) => h.conversationId)).toEqual(['c1'])
    expect(searchAll('viet nam').map((h) => h.conversationId)).toEqual(['c2'])
    expect(searchAll('ke hoach').map((h) => h.conversationId)).toEqual(['c2'])
    expect(searchAll('nothing here')).toEqual([])
  })

  it('one hit per conversation, newest conversation first, with a snippet', () => {
    for (let i = 0; i < 300; i++) msg('c1', `deploy note ${i}`)
    msg('c2', 'another deploy discussion')
    const hits = searchAll('deploy')
    expect(hits.map((h) => h.conversationId)).toEqual(['c2', 'c1'])
    expect(hits[1].snippet).toContain('deploy note 299')
    expect(hits.every((h) => h.kind === 'message')).toBe(true)
  })

  it('stays in sync on delete-from and conversation delete (cascade)', () => {
    const a = msg('c1', 'alpha message'); msg('c1', 'alpha again')
    msg('c3', 'alpha in c3')
    deleteMessagesFrom('c1', a.id)
    expect(searchAll('alpha').map((h) => h.conversationId)).toEqual(['c3'])
    deleteConversation('c3')
    expect(searchAll('alpha')).toEqual([])
    expect((testDb().prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'alpha'").get() as { n: number }).n).toBe(0)
  })

  it('indexes messages that existed before the migration', () => {
    // resetTestDb ran all migrations on an empty DB; simulate old rows + rebuild.
    const d = testDb()
    d.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('old', 'c1', 'user', 'legacy kubernetes text', 1)").run()
    d.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')")
    expect(searchAll('kubernetes').map((h) => h.conversationId)).toEqual(['c1'])
  })

  it('falls back to substring search for symbol-only queries and keeps title hits first', () => {
    msg('c1', 'use a -> b arrow')
    testDb().prepare("UPDATE conversations SET title = 'Arrow syntax' WHERE id = 'c2'").run()
    expect(searchAll('->').map((h) => h.conversationId)).toEqual(['c1'])
    const hits = searchAll('arrow')
    expect(hits[0]).toMatchObject({ conversationId: 'c2', kind: 'title' })
    expect(hits.map((h) => h.conversationId)).toContain('c1')
  })
})

describe('searchAll fallback (D-100)', () => {
  beforeEach(() => { resetTestDb(); t = 0; seedConversation('c1'); seedConversation('c2') })
  it('falls back to substring search when prefix matching finds nothing', () => {
    msg('c1', 'edit codexConfig.ts next')
    msg('c2', '今天我们讨论数据库设计')
    expect(searchAll('Config').map((h) => h.conversationId)).toEqual(['c1'])
    expect(searchAll('数据库').map((h) => h.conversationId)).toEqual(['c2'])
  })
  it('does not fall back when prefix matching found something', () => {
    msg('c1', 'Config file updated')
    msg('c2', 'edit codexConfig.ts next')
    expect(searchAll('Config').map((h) => h.conversationId)).toEqual(['c1'])
  })
})
