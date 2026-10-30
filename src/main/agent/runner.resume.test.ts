import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { resetTestDb, testDb } from '../testing/memoryDb'
import type { AgentEvent, AgentRequest } from '../../shared/agent'

// D-146: guarded resume — the next turn resumes the agent's own session only when nothing else
// changed; a failed resume runs fresh with the conversation.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('./snapshotService', () => ({ maybeCompress: async () => {} }))

type Call = { req: AgentRequest; resume?: string }
const calls: Call[] = []
let failResume = false
let session = 0
let total = 0
vi.mock('../providers/registry', () => ({
  createProvider: () => ({
    name: 'Claude',
    isAvailable: async () => ({ installed: true }),
    cancel: async () => {},
    async *run(req: AgentRequest, resume?: string): AsyncGenerator<AgentEvent> {
      calls.push({ req, resume })
      if (resume && failResume) { yield { type: 'error', message: 'No conversation found with session ID', fatal: true }; return }
      yield { type: 'session_started', providerSessionId: `s${++session}` } as AgentEvent
      yield { type: 'text_delta', text: 'ok' }
      total = resume ? total + 0.1 : 0.5   // like Claude: the session's running cost
      yield { type: 'complete', usage: { costUsd: total } }
    }
  })
}))

const { startRun } = await import('./runner')
const { appendMessage, listMessages } = await import('../conversations/messagesRepo')
const { setSetting } = await import('../database/settingsRepo')
const sender = { isDestroyed: () => true, send: () => {} } as never

/** Send a message and let the run finish. */
async function turn(text: string, opts: { providerId?: 'claude-code' | 'codex'; model?: string } = {}): Promise<Call> {
  appendMessage({ conversationId: 'c1', role: 'user', content: text })
  await new Promise<void>((done) => startRun(sender, { conversationId: 'c1', providerId: opts.providerId ?? 'claude-code', prompt: text, cwd: '/work/proj', model: opts.model ?? 'opus', onDone: () => done() }))
  return calls[calls.length - 1]
}

beforeEach(() => {
  resetTestDb(); calls.length = 0; failResume = false; session = 0; total = 0
  const now = Date.now()
  testDb().prepare(`INSERT INTO projects (id, name, folder_path, created_at, last_opened_at) VALUES ('p1', 'Sandbox', '/work/proj', ?, ?)`).run(now, now)
  testDb().prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES ('c1', 'p1', 'Chat', 'claude-code', ?, ?)`).run(now, now)
})

describe('guarded resume (D-146)', () => {
  it('resumes the previous reply\'s session and sends no transcript', async () => {
    const first = await turn('hello')
    expect(first.resume).toBeUndefined()
    const second = await turn('and then?')
    expect(second.resume).toBe('s1')
    expect(second.req.context?.snapshot).toBeUndefined()
    const third = await turn('one more')
    expect(third.resume).toBe('s2')                      // each turn resumes the newest fork
    expect(listMessages('c1').filter((m) => m.role === 'assistant').map((m) => m.metadata?.contextMode)).toEqual(['fresh', 'resume', 'resume'])
    const costs = listMessages('c1').filter((m) => m.role === 'assistant').map((m) => Math.round(((m.metadata?.usage as { costUsd: number }).costUsd) * 100) / 100)
    expect(costs).toEqual([0.5, 0.1, 0.1])               // each reply's own cost, not the running total
  })
  it('runs fresh with the conversation when something changed', async () => {
    await turn('hello')
    expect((await turn('switch model', { model: 'sonnet' })).resume).toBeUndefined()
    await turn('back on sonnet', { model: 'sonnet' })
    appendMessage({ conversationId: 'c1', role: 'assistant', provider: 'codex', content: 'from Codex' })   // another agent answered
    const after = await turn('next', { model: 'sonnet' })
    expect(after.resume).toBeUndefined()
    expect(after.req.context?.snapshot).toContain('from Codex')
  })
  it('never resumes for another agent', async () => {
    await turn('hello', { providerId: 'codex' })
    expect((await turn('again', { providerId: 'codex' })).resume).toBeUndefined()
  })
  it('falls back to a fresh run when the resume fails', async () => {
    await turn('hello')
    failResume = true
    await turn('and then?')
    const [resumed, fresh] = calls.slice(-2)
    expect(resumed.resume).toBe('s1')
    expect(fresh.resume).toBeUndefined()
    expect(fresh.req.context?.snapshot).toContain('hello')
    const last = listMessages('c1').at(-1)!
    expect(last.content).toBe('ok')
    expect(last.metadata?.contextMode).toBe('shared')
  })
  it('can be switched off', async () => {
    setSetting('agent_resume', '0')
    await turn('hello')
    expect((await turn('again')).resume).toBeUndefined()
  })
})
