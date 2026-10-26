import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetTestDb, testDb } from '../testing/memoryDb'

// D-118: every finished chat turn leaves one run-log line — outcome, source, agents and the
// files edited — including a run that failed before writing any reply.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('../tools/codexModels', () => ({ modelLists: () => ({}) }))
let behaviour: 'reply' | 'fail' | 'hang' = 'reply'
let pending: ((id: string | null, err?: string) => void) | undefined
vi.mock('./runner', async () => {
  const { appendMessage } = await import('../conversations/messagesRepo')
  return {
    startRun: (_s: unknown, p: { conversationId: string; providerId: string; onDone?: (id: string | null, err?: string) => void }) => {
      if (behaviour === 'hang') { pending = p.onDone; return 'run-hang' }
      setTimeout(() => {
        if (behaviour === 'fail') return p.onDone?.(null, 'Codex timed out after 15 min with no reply.')
        const m = appendMessage({ conversationId: p.conversationId, role: 'assistant', provider: p.providerId as never, content: 'ok', metadata: { actions: [{ kind: 'file', label: 'plan.md', path: '/work/proj/plan.md', at: 1 }] } })
        p.onDone?.(m.id)
      }, 5)
      return 'run-1'
    },
    cancelRun: async () => { const f = pending; pending = undefined; setTimeout(() => f?.(null), 5) }   // a stopped CLI exits; the runner reports done
  }
})
const { startTurn, cancelTurn } = await import('./turns')
const { initRunLog, readRunLog } = await import('./runLog')
const sender = { isDestroyed: () => true, send: () => {} } as never
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)) }

beforeEach(() => {
  resetTestDb(); initRunLog(join(mkdtempSync(join(tmpdir(), 'rl-')), 'run-log.jsonl'))
  const now = Date.now()
  testDb().prepare(`INSERT INTO projects (id, name, folder_path, created_at, last_opened_at) VALUES ('p1', 'Sandbox', '/work/proj', ?, ?)`).run(now, now)
  testDb().prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES ('c1', 'p1', 'Plan it', 'claude-code', ?, ?)`).run(now, now)
})

describe('run log from real turns (D-118)', () => {
  it('records a finished command-line turn with the files it edited', async () => {
    behaviour = 'reply'
    startTurn(sender, { conversationId: 'c1', text: 'write the plan', defaultProvider: 'claude-code', messageMetadata: { via: 'cli' } })
    await until(() => readRunLog(0).length > 0)
    expect(readRunLog(0)[0]).toMatchObject({ kind: 'chat', chat: 'c1', project: 'Sandbox', title: 'Plan it', source: 'cli', agents: ['claude-code'], state: 'done', error: null, files: ['plan.md'] })
    expect(readRunLog(0)[0].run).toMatch(/^c1\./)
  })
  it('records a failure that left no reply, and where a scheduled run came from', async () => {
    behaviour = 'fail'
    startTurn(sender, { conversationId: 'c1', text: 'daily digest', defaultProvider: 'codex', messageMetadata: { scheduled: true } })
    await until(() => readRunLog(0).length > 0)
    expect(readRunLog(0)[0]).toMatchObject({ source: 'schedule', state: 'error', error: 'Codex timed out after 15 min with no reply.', agents: ['codex'] })
  })
  it('records a stopped turn as stopped', async () => {
    behaviour = 'hang'
    startTurn(sender, { conversationId: 'c1', text: 'long job', defaultProvider: 'claude-code' })
    await cancelTurn('c1')
    await until(() => readRunLog(0).length > 0)
    expect(readRunLog(0)[0]).toMatchObject({ state: 'stopped', error: null })
  })
  it('a start refused because the agent is off leaves no finish hook behind (audit #18)', async () => {
    behaviour = 'reply'
    testDb().prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('disabled_agents', 'codex')`).run()
    const onFinished = vi.fn()
    expect(() => startTurn(sender, { conversationId: 'c1', text: 'scheduled digest', defaultProvider: 'codex', messageMetadata: { scheduled: true } }, { onFinished })).toThrow()
    startTurn(sender, { conversationId: 'c1', text: 'an unrelated message', defaultProvider: 'claude-code' })
    await until(() => readRunLog(0).length > 0)
    expect(onFinished).not.toHaveBeenCalled()
  })
})
