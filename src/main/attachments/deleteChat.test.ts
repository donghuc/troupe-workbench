import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetTestDb, seedConversation, testDb } from '../testing/memoryDb'

// Audit 2026-10-26: a chat in a project with no folder keeps its attachments in the app's own
// store; deleting the chat deletes them, unless another chat still refers to one.
const userData = mkdtempSync(join(tmpdir(), 'troupe-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
const { deleteChatWithFiles, chatAttachmentCount } = await import('./deleteChat')
const { appendMessage } = await import('../conversations/messagesRepo')

const store = join(userData, 'attachments')
const file = (name: string) => { const p = join(store, name); writeFileSync(p, 'x'); return p }

beforeEach(() => { resetTestDb(); mkdirSync(store, { recursive: true }) })

describe('deleting a folderless chat deletes its stored attachments', () => {
  it('removes the chat\'s files, keeps one another chat uses, never touches other paths', async () => {
    seedConversation('c1'); seedConversation('c2')
    const mine = file('1-scan.pdf'), shared = file('2-logo.png'), elsewhere = join(userData, 'other.txt')
    writeFileSync(elsewhere, 'keep')
    appendMessage({ conversationId: 'c1', role: 'user', content: 'see these', metadata: { attachments: [{ name: 'scan.pdf', path: mine }, { name: 'logo.png', path: shared, image: true }, { name: 'o', path: elsewhere }] } })
    appendMessage({ conversationId: 'c2', role: 'user', content: 'same logo', metadata: { attachments: [{ name: 'logo.png', path: shared, image: true }] } })
    expect(await chatAttachmentCount('c1')).toBe(2)
    await deleteChatWithFiles('c1')
    expect(existsSync(mine)).toBe(false)
    expect(existsSync(shared)).toBe(true)     // c2 still shows it
    expect(existsSync(elsewhere)).toBe(true)  // not in the store: not ours to delete
  })
})
