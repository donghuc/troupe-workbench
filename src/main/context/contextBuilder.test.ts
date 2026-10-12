import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestDb, seedConversation, testDb } from '../testing/memoryDb'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
const { buildConversationContext } = await import('./contextBuilder')
const { insertSnapshot } = await import('../conversations/snapshotRepo')
const { listMessages } = await import('../conversations/messagesRepo')
const { buildContextBlock, formatTranscript } = await import('../agent/handoff')
const { SINCE_SUMMARY_TRANSCRIPT } = await import('../../shared/contextBudget')

// The pre-D-091 algorithm, kept here as the reference the windowed version must match.
function reference(conv: string, excludeTrailing: number): string {
  let msgs = listMessages(conv)
  // (the old slice went negative when excluding more than exist; the new code clamps to empty)
  if (excludeTrailing > 0) msgs = msgs.slice(0, Math.max(0, msgs.length - excludeTrailing))
  if (msgs.length === 0) return ''
  const snap = testDb().prepare('SELECT content, through_count AS t FROM session_snapshots WHERE conversation_id = ? ORDER BY through_count DESC, created_at DESC LIMIT 1').get(conv) as { content: string; t: number } | undefined
  return snap
    ? ['# Conversation summary so far (compressed)', snap.content,
        ...(msgs.length > snap.t ? ['', '# Recent turns since the summary', formatTranscript(msgs.slice(snap.t), SINCE_SUMMARY_TRANSCRIPT), '', "Respond to the User's latest message using this shared context."] : [])].join('\n')
    : buildContextBlock(msgs)
}

function seed(n: number): void {
  const ins = testDb().prepare('INSERT INTO messages (id, conversation_id, role, provider, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  for (let i = 0; i < n; i++) ins.run(`m${i}`, 'c1', i % 2 ? 'assistant' : 'user', i % 2 ? 'claude-code' : null, `message ${i} ${'x'.repeat(i * 37 % 900)}`, 1000 + i)
}

describe('conversation context, windowed reads (D-091)', () => {
  beforeEach(() => { resetTestDb(); seedConversation('c1') })

  for (const n of [0, 1, 2, 7, 45]) {
    for (const ex of [0, 1, 3]) {
      it(`matches the full-read version: ${n} messages, exclude ${ex}, no summary`, () => {
        seed(n)
        expect(buildConversationContext('c1', ex)).toBe(reference('c1', ex))
      })
    }
  }
  for (const through of [0, 5, 20, 44, 45]) {
    for (const ex of [0, 1, 2]) {
      it(`matches with a summary through ${through} of 45, exclude ${ex}`, () => {
        seed(45)
        insertSnapshot('c1', 'SUMMARY', through, 'claude-code')
        expect(buildConversationContext('c1', ex)).toBe(reference('c1', ex))
      })
    }
  }
})
