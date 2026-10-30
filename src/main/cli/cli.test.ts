import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { execFile } from 'child_process'
import { mkdtempSync, statSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { resetTestDb, testDb } from '../testing/memoryDb'

// D-117: the command line end to end — real socket server, real `troupe` script over curl,
// in-memory database. The agent run itself is a stand-in: startTurn stores the user message
// (as the real one does) and the test decides when the reply lands.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false, getVersion: () => '9.9.9' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('../tools/codexModels', () => ({ modelLists: () => ({}) }))
const busy = new Map<string, { provider: string; text: string }>()
const started: Record<string, unknown>[] = []
vi.mock('../agent/turns', async () => {
  const { appendMessage } = await import('../conversations/messagesRepo')
  return {
    isBusy: (id: string) => busy.has(id),
    startTurn: (_s: unknown, input: { conversationId: string; text: string; defaultProvider: string; messageMetadata?: Record<string, unknown> }) => {
      if (busy.has(input.conversationId)) { const e = new Error('This conversation is already running a turn.'); e.name = 'ConversationBusyError'; throw e }
      started.push(input as unknown as Record<string, unknown>)
      appendMessage({ conversationId: input.conversationId, role: 'user', content: input.text, metadata: input.messageMetadata ?? null })
      busy.set(input.conversationId, { provider: input.defaultProvider, text: '' })
    },
    cancelTurn: async (id: string) => { busy.delete(id) },
    getTurnState: (id: string) => ({ conversationId: id, busy: busy.has(id), parallel: false, error: null, rev: 0,
      lanes: busy.has(id) ? [{ provider: busy.get(id)!.provider, text: busy.get(id)!.text, activity: null, done: false }] : [] })
  }
})
const { runCliCommand } = await import('./cliCommands')
const { startCliServer, stopCliServer } = await import('./cliServer')
const { appendMessage } = await import('../conversations/messagesRepo')
const { installCommand, wrapperFor, WRAPPER_MARK } = await import('./cliInstall')

const P = (o: Record<string, string>) => new URLSearchParams(o)
function seed(): void {
  const d = testDb(); const now = Date.now()
  d.prepare(`INSERT INTO projects (id, name, folder_path, created_at, last_opened_at) VALUES ('p-sandbox-0001', 'Workbench sandbox', '/tmp/wb', ?, ?)`).run(now, now)
  d.prepare(`INSERT INTO projects (id, name, created_at, last_opened_at) VALUES ('p-proj-0002', 'My project', ?, ?)`).run(now, now)
}
function reply(chatId: string, text: string): void {
  const b = busy.get(chatId)!; busy.delete(chatId)
  appendMessage({ conversationId: chatId, role: 'assistant', provider: b.provider as never, content: text })
}

describe('cli commands (D-117)', () => {
  beforeEach(() => { resetTestDb(); seed(); busy.clear(); started.length = 0 })

  it('version, and token use per reply in show / status (2.18.1)', async () => {
    expect((await runCliCommand('version', P({}))).text).toBe('Troupe 9.9.9')
    expect((await runCliCommand('version', P({}))).json).toEqual({ version: '9.9.9' })
    const { run, chat } = (await runCliCommand('send', P({ to: 'sandbox', message: 'hi' }))).json as { run: string; chat: string }
    busy.delete(chat)
    appendMessage({ conversationId: chat, role: 'assistant', provider: 'claude-code', content: 'hello', metadata: { contextMode: 'resume', modelUsed: 'claude-opus-5-5', usage: { inputTokens: 2, cacheReadTokens: 87900, cacheCreationTokens: 3398, outputTokens: 381, costUsd: 0.0524 } } })
    const usage = { input: 91300, cacheRead: 87900, cacheWrite: 3398, output: 381, costUsd: 0.0524, mode: 'resume', model: 'claude-opus-5-5' }
    expect((await runCliCommand('status', P({ run }))).json).toMatchObject({ replies: [{ text: 'hello', usage }] })
    const shown = await runCliCommand('show', P({ chat }))
    expect(shown.json).toMatchObject({ messages: [{ role: 'user' }, { role: 'assistant', usage }] })
    expect((shown.json as { messages: { usage?: unknown }[] }).messages[0].usage).toBeUndefined()
    expect(shown.text).toContain('91.3k in · 87.9k cached · 381 out · $0.0524 · resumed')
  })

  it('lists projects and chats by name', async () => {
    const r = await runCliCommand('projects', P({}))
    expect(r.status).toBe(200)
    expect(r.text).toContain('Workbench sandbox  (0 chats)  /tmp/wb')
    expect((await runCliCommand('chats', P({ project: 'project' }))).text).toBe('No chats in this project.')
    expect((await runCliCommand('chats', P({ project: 'nope' }))).status).toBe(404)
  })

  it('send starts a new chat in Auto, marked as from the command line; status follows it to the reply', async () => {
    const s = await runCliCommand('send', P({ to: 'sandbox', message: 'summarise PLAN.md' }))
    expect(s.status).toBe(200)
    const { run, chat } = s.json as { run: string; chat: string }
    expect(started[0]).toMatchObject({ conversationId: chat, text: 'summarise PLAN.md', permissionMode: 'auto', cwd: '/tmp/wb', defaultProvider: 'claude-code', messageMetadata: { via: 'cli' } })
    busy.get(chat)!.text = 'Reading PLAN'
    const mid = await runCliCommand('status', P({ run }))
    expect(mid.json).toMatchObject({ state: 'running', partial: [{ text: 'Reading PLAN' }] })
    reply(chat, 'PLAN.md has three phases.')
    const end = await runCliCommand('status', P({ run }))
    expect(end.json).toMatchObject({ state: 'done', replies: [{ role: 'assistant', text: 'PLAN.md has three phases.' }] })
    // the chat now shows in the project and in `show`
    expect((await runCliCommand('chats', P({ project: 'sandbox' }))).text).toContain('summarise PLAN.md')
    expect((await runCliCommand('show', P({ chat, last: '1' }))).text).toContain('PLAN.md has three phases.')
  })

  it('a follow-up continues the chat; status covers only its own reply', async () => {
    const first = (await runCliCommand('send', P({ to: 'sandbox', message: 'one' }))).json as { chat: string; run: string }
    reply(first.chat, 'reply one')
    await new Promise((r) => setTimeout(r, 5))
    const second = (await runCliCommand('send', P({ to: first.chat, message: 'two', mode: 'read' }))).json as { chat: string; run: string }
    expect(second.chat).toBe(first.chat)
    expect(started[1]).toMatchObject({ permissionMode: 'read' })
    reply(first.chat, 'reply two')
    expect((await runCliCommand('status', P({ run: first.run }))).json).toMatchObject({ state: 'done', replies: [{ text: 'reply one' }] })
    expect((await runCliCommand('status', P({ run: second.run }))).json).toMatchObject({ state: 'done', replies: [{ text: 'reply two' }] })
  })

  it('refuses Full access, empty messages, unknown agents and a busy chat', async () => {
    expect((await runCliCommand('send', P({ to: 'sandbox', message: 'x', mode: 'full' }))).text).toMatch(/Full access is not available/)
    expect((await runCliCommand('send', P({ to: 'sandbox', message: '   ' }))).status).toBe(400)
    expect((await runCliCommand('send', P({ to: 'sandbox', message: 'x', agent: 'nobody' }))).status).toBe(404)
    const { chat } = (await runCliCommand('send', P({ to: 'sandbox', message: 'x' }))).json as { chat: string }
    expect((await runCliCommand('send', P({ to: chat, message: 'y' }))).status).toBe(409)
    expect(started).toHaveLength(1)
  })

  it('stop cancels a running reply; status then says stopped', async () => {
    const { run } = (await runCliCommand('send', P({ to: 'sandbox', message: 'long job' }))).json as { run: string }
    expect((await runCliCommand('stop', P({ run }))).text).toBe('Stopped.')
    expect((await runCliCommand('status', P({ run }))).json).toMatchObject({ state: 'stopped' })
  })

  it('has no commands beyond projects and chats', async () => {
    for (const cmd of ['settings', 'image', 'memory', 'deleteProject', 'sql']) expect((await runCliCommand(cmd, P({}))).status).toBe(404)
  })
})

// The bash script and Unix socket are macOS-only; Windows uses the pipe client (cliMore.test.ts, D-120).
describe.skipIf(process.platform === 'win32')('troupe script over the socket (D-117)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tc-'))
  const sock = join(dir, 's.sock')
  const script = fileURLToPath(new URL('../../../resources/troupe', import.meta.url))
  const troupe = (args: string[], input?: string): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
    const p = execFile('/bin/bash', [script, ...args], { env: { ...process.env, TROUPE_SOCKET: sock } }, (e, out, err) =>
      resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out, err }))
    if (input !== undefined) { p.stdin!.write(input); p.stdin!.end() }
  })
  afterAll(() => stopCliServer())

  it('says Troupe is unreachable when the socket is closed', async () => {
    const r = await troupe(['projects'])
    expect(r.code).toBe(3)
    expect(r.err).toMatch(/turn on Settings ▸ Tools ▸ Command line/)
  })

  it('runs commands end to end; the socket is private to this user', async () => {
    resetTestDb(); seed(); busy.clear(); started.length = 0
    await startCliServer(sock)
    expect(statSync(sock).mode & 0o777).toBe(0o600)
    expect((await troupe(['projects'])).out).toContain('My project')
    const sent = await troupe(['send', 'sandbox', 'quote "this" & that\nsecond line', '--agent', 'codex', '--json'])
    expect(sent.code).toBe(0)
    const { run, chat } = JSON.parse(sent.out)
    expect(started[0]).toMatchObject({ text: 'quote "this" & that\nsecond line', defaultProvider: 'codex' })
    setTimeout(() => reply(chat, 'all done'), 300)
    const st = await troupe(['status', run, '--wait', '5'])
    expect(st.out).toContain(`run ${run}: done`)
    expect(st.out).toContain('all done')
    const fromStdin = await troupe(['send', chat, '-'], 'from stdin')
    expect(fromStdin.code).toBe(0)
    expect(started[1]).toMatchObject({ text: 'from stdin', conversationId: chat })
  })

  it('reports refusals with exit code 1 and usage errors with 2', async () => {
    const r = await troupe(['send', 'sandbox', 'x', '--mode', 'full'])
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toBe('error: Full access is not available from the command line. Use --mode read or auto.\n')   // no curl noise
    const j = await troupe(['send', 'nowhere', 'x', '--json'])
    expect(j.code).toBe(1)
    expect(JSON.parse(j.err)).toEqual({ error: 'No project called "nowhere".' })
    expect((await troupe(['send', 'sandbox'])).code).toBe(2)
    expect((await troupe(['frobnicate'])).code).toBe(2)
  })
})

describe.skipIf(process.platform === 'win32')('installing the troupe command (D-117)', () => {
  it('writes a wrapper that runs the bundled script, and never overwrites a stranger\'s file', () => {
    const bin = mkdtempSync(join(tmpdir(), 'tb-'))
    const r = installCommand('/Applications/Troupe.app/Contents/Resources/troupe', `/usr/bin:${bin}`, bin)
    expect(r).toEqual({ path: join(bin, 'troupe'), onPath: true })
    const body = readFileSync(r.path, 'utf8')
    expect(body).toBe(wrapperFor('/Applications/Troupe.app/Contents/Resources/troupe'))
    expect(body).toContain(WRAPPER_MARK)
    expect(statSync(r.path).mode & 0o111).toBeTruthy()
    expect(installCommand('/x/troupe', '/usr/bin', bin).onPath).toBe(false)   // reinstall over our own is fine
    const other = mkdtempSync(join(tmpdir(), 'tb-'))
    writeFileSync(join(other, 'troupe'), '#!/bin/sh\necho mine\n')
    expect(() => installCommand('/x/troupe', '', other)).toThrow(/wasn't installed by Troupe/)
    expect(existsSync(join(other, 'troupe'))).toBe(true)
  })
})
