import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestDb, seedConversation, testDb } from '../testing/memoryDb'

vi.mock('../database/db', () => ({ getDb: () => testDb() }))
const repo = await import('./messagesRepo')

// Messages with explicit timestamps (some equal, to exercise the rowid tiebreak).
function seed(rows: Array<[role: 'user' | 'assistant', content: string, at: number]>): void {
  const ins = testDb().prepare('INSERT INTO messages (id, conversation_id, role, provider, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  rows.forEach(([role, content, at], i) => ins.run(`m${i}`, 'c1', role, role === 'assistant' ? 'codex' : null, content, at))
}

describe('windowed message reads (D-091)', () => {
  beforeEach(() => { resetTestDb(); seedConversation('c1') })

  it('counts and pages in transcript order', () => {
    seed([['user', 'a', 1], ['assistant', 'b', 2], ['user', 'c', 2], ['assistant', 'd', 3]])
    expect(repo.countMessages('c1')).toBe(4)
    expect(repo.countMessages('nope')).toBe(0)
    expect(repo.listMessagesFrom('c1', 0).map((m) => m.content)).toEqual(['a', 'b', 'c', 'd'])
    expect(repo.listMessagesFrom('c1', 1, 2).map((m) => m.content)).toEqual(['b', 'c'])
    expect(repo.listMessagesFrom('c1', 3).map((m) => m.content)).toEqual(['d'])
    expect(repo.listMessagesFrom('c1', 9)).toEqual([])
    expect(repo.listMessagesFrom('c1', 0).map((m) => m.id)).toEqual(repo.listMessages('c1').map((m) => m.id))
  })

  it('lastUserTurn returns the last user message and what follows, ties broken by insert order', () => {
    seed([['user', 'q1', 1], ['assistant', 'r1', 2], ['user', 'q2', 5], ['assistant', 'r2', 5], ['assistant', 'r3', 6]])
    const t = repo.lastUserTurn('c1')
    expect(t.user?.content).toBe('q2')
    expect(t.after.map((m) => m.content)).toEqual(['r2', 'r3'])
  })

  it('lastUserTurn with no user message returns the whole transcript', () => {
    seed([['assistant', 'x', 1], ['assistant', 'y', 2]])
    const t = repo.lastUserTurn('c1')
    expect(t.user).toBeNull()
    expect(t.after.map((m) => m.content)).toEqual(['x', 'y'])
  })

  it('lastUserTurn right after a user message has no replies', () => {
    seed([['assistant', 'x', 1], ['user', 'q', 2]])
    expect(repo.lastUserTurn('c1').after).toEqual([])
  })
})
