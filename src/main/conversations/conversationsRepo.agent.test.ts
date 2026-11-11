import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestDb, seedConversation, testDb } from '../testing/memoryDb'

vi.mock('../database/db', () => ({ getDb: () => testDb() }))
const repo = await import('./conversationsRepo')

describe('the agent and model picked in a chat are remembered', () => {
  beforeEach(() => { resetTestDb(); seedConversation('c1') })

  it('saves the pick at once, and the default model as none', () => {
    const before = repo.getConversation('c1')!.updatedAt
    repo.setConversationAgent('c1', 'codex', 'gpt-5.5')
    expect(repo.getConversation('c1')).toMatchObject({ provider: 'codex', model: 'gpt-5.5' })
    repo.setConversationAgent('c1', 'claude-code', '')
    expect(repo.getConversation('c1')).toMatchObject({ provider: 'claude-code', model: null })
    expect(repo.getConversation('c1')!.updatedAt).toBe(before)   // picking isn't activity
  })
})
