import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { resetTestDb, testDb } from '../testing/memoryDb'
import type { AgentEvent } from '../../shared/agent'

// 2026-11-03: the run timeout counts from the last output, with a ceiling of 4× overall.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('./snapshotService', () => ({ maybeCompress: async () => {} }))

let script: { every: number; count: number } = { every: 10, count: 1 }
vi.mock('../providers/registry', () => ({
  createProvider: () => {
    let cancelled = false
    return {
      name: 'Claude',
      isAvailable: async () => ({ installed: true }),
      cancel: async () => { cancelled = true },
      async *run(): AsyncGenerator<AgentEvent> {
        for (let i = 0; i < script.count && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, script.every))
          if (!cancelled) yield { type: 'text_delta', text: '.' }
        }
        if (!cancelled) yield { type: 'complete', usage: {} }
      }
    }
  }
}))

const { startRun } = await import('./runner')
const sender = { isDestroyed: () => true, send: () => {} } as never
const run = (timeoutMs: number) => new Promise<string | undefined>((done) =>
  startRun(sender, { conversationId: 'c1', providerId: 'codex', prompt: 'go', cwd: '/w', timeoutMs, noConversationContext: true, onDone: (_id, err) => done(err) }))

beforeEach(() => {
  resetTestDb()
  const now = Date.now()
  testDb().prepare(`INSERT INTO projects (id, name, folder_path, created_at, last_opened_at) VALUES ('p1', 'P', '/w', ?, ?)`).run(now, now)
  testDb().prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES ('c1', 'p1', 'Chat', 'codex', ?, ?)`).run(now, now)
})

describe('run watchdog', () => {
  it('lets a run that keeps producing output go past the timeout', async () => {
    script = { every: 40, count: 6 }          // ~240 ms in all, never 100 ms quiet
    expect(await run(100)).toBeUndefined()
  })
  it('stops a run that goes quiet for the timeout', async () => {
    script = { every: 250, count: 1 }
    expect(await run(100)).toMatch(/stopped after \d+ min without any output/)
  })
  it('stops a run that never stops talking at 4× the timeout', async () => {
    script = { every: 20, count: 1000 }
    const t0 = Date.now()
    expect(await run(100)).toMatch(/still running after/)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(390)
  })
})
