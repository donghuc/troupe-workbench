import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { resetTestDb, testDb } from '../testing/memoryDb'

// D-138: messages sent while a chat is busy run one by one, each its own turn; Stop pauses.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('../tools/codexModels', () => ({ modelLists: () => ({}) }))
vi.mock('./runLog', () => ({ appendRunLog: () => {} }))
const running: { prompt: string; done: (err?: string) => void }[] = []
vi.mock('./runner', async () => {
  const { appendMessage } = await import('../conversations/messagesRepo')
  return {
    startRun: (_s: unknown, p: { conversationId: string; providerId: string; prompt: string; onDone?: (id: string | null, err?: string) => void }) => {
      running.push({ prompt: p.prompt, done: (err) => { if (err) return p.onDone?.(null, err); const m = appendMessage({ conversationId: p.conversationId, role: 'assistant', provider: p.providerId as never, content: 'ok' }); p.onDone?.(m.id) } })
      return `run-${running.length}`
    },
    cancelRun: async () => { const r = running[running.length - 1]; setTimeout(() => r?.done(), 1) }
  }
})

const { sendOrQueue, getQueue, removeQueued, editQueued, resumeQueue, initTurnQueue } = await import('./turnQueue')
const { cancelTurn, isBusy } = await import('./turns')
const { listMessages } = await import('../conversations/messagesRepo')
const sender = { isDestroyed: () => true, send: () => {} } as never
const send = (text: string) => sendOrQueue(sender, { conversationId: 'c1', text, defaultProvider: 'claude-code' })
const tick = () => new Promise((r) => setTimeout(r, 5))
const userTexts = () => listMessages('c1').filter((m) => m.role === 'user').map((m) => m.content)
let inited = false

beforeEach(() => {
  resetTestDb(); running.length = 0
  const now = Date.now()
  testDb().prepare(`INSERT INTO projects (id, name, folder_path, created_at, last_opened_at) VALUES ('p1', 'Sandbox', '/work/proj', ?, ?)`).run(now, now)
  testDb().prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES ('c1', 'p1', 'Chat', 'claude-code', ?, ?)`).run(now, now)
  if (!inited) { initTurnQueue(); inited = true }
})

describe('message queue (D-138)', () => {
  it('queues while busy and runs each message as its own turn, in order', async () => {
    expect(send('first').turn).toBeTruthy()
    send('second'); send('third')
    expect(getQueue('c1').items.map((i) => i.text)).toEqual(['second', 'third'])
    expect(userTexts()).toEqual(['first'])                 // queued messages aren't in the chat yet
    running[0].done(); await tick()
    expect(userTexts()).toEqual(['first', 'second'])
    expect(getQueue('c1').items.map((i) => i.text)).toEqual(['third'])
    running[1].done(); await tick()
    running[2].done(); await tick()
    expect(userTexts()).toEqual(['first', 'second', 'third'])
    expect(getQueue('c1').items).toEqual([])
    expect(isBusy('c1')).toBe(false)
  })
  it('pauses after Stop; Resume carries on', async () => {
    send('first'); send('second')
    await cancelTurn('c1'); await tick(); await tick()
    expect(getQueue('c1')).toMatchObject({ paused: 'stopped', items: [{ text: 'second' }] })
    expect(isBusy('c1')).toBe(false)
    resumeQueue('c1')
    expect(userTexts()).toEqual(['first', 'second'])
    running[1].done(); await tick()
  })
  it('pauses after a failed turn', async () => {
    send('first'); send('second')
    running[0].done('Codex timed out'); await tick()
    expect(getQueue('c1')).toMatchObject({ paused: 'error', items: [{ text: 'second' }] })
    resumeQueue('c1'); running[1].done(); await tick()
  })
  it('edits and removes waiting messages', async () => {
    send('first'); send('second'); send('third')
    const [a, b] = getQueue('c1').items
    editQueued('c1', a.id, 'second, reworded')
    removeQueued('c1', b.id)
    running[0].done(); await tick()
    expect(userTexts()).toEqual(['first', 'second, reworded'])
    running[1].done(); await tick()
  })
})
