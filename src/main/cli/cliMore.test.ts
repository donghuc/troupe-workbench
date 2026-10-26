import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFile } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { resetTestDb, testDb } from '../testing/memoryDb'

// D-118: the second batch of `troupe` commands — runs, schedules, rename/delete, read-only
// files, attachments, files changed, search, context, --think, --wait-free and Collab.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, Notification: class { static isSupported() { return false } } }))
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
      if (busy.has(input.conversationId)) { const e = new Error('busy'); e.name = 'ConversationBusyError'; throw e }
      started.push(input as unknown as Record<string, unknown>)
      appendMessage({ conversationId: input.conversationId, role: 'user', content: input.text, metadata: input.messageMetadata ?? null })
      busy.set(input.conversationId, { provider: input.defaultProvider, text: '' })
    },
    cancelTurn: async (id: string) => { busy.delete(id) },
    getTurnState: (id: string) => ({ conversationId: id, busy: busy.has(id), parallel: false, error: null, rev: 0, lanes: [] })
  }
})
const fired: string[] = []
vi.mock('../schedules/scheduler', () => ({ runScheduleNow: (s: { id: string }) => { fired.push(s.id) } }))
const collabCalls: string[] = []
vi.mock('../collab/orchestrator', async () => {
  const repo = await import('../collab/collabRepo')
  return {
    startCollab: (_s: unknown, input: Parameters<typeof repo.createCollabRun>[0]) => { collabCalls.push('start'); const r = repo.createCollabRun(input); return repo.updateCollabRun(r.id, { status: 'awaiting_confirmation' }) },
    confirmPlan: (_s: unknown, id: string) => { collabCalls.push('confirm'); return repo.updateCollabRun(id, { status: 'running' }) },
    stopCollab: (id: string) => { collabCalls.push('stop'); return repo.updateCollabRun(id, { status: 'stopped', reason: 'Stopped by you.' }) },
    resumeCollab: (_s: unknown, id: string) => { collabCalls.push('resume'); return repo.updateCollabRun(id, { status: 'running' }) },
    recoverTask: (_s: unknown, id: string, taskId: string, a: { type: string; note?: string }) => { collabCalls.push(`recover:${taskId}:${a.type}:${a.note ?? ''}`); return repo.getCollabRun(id) },
    applyRepair: (_s: unknown, id: string, i: number) => { collabCalls.push(`repair:${i}`); return repo.getCollabRun(id) }
  }
})
const { runCliCommand } = await import('./cliCommands')
const { appendMessage } = await import('../conversations/messagesRepo')
const { initRunLog, appendRunLog, readRunLog } = await import('../agent/runLog')
const { startCliServer } = await import('./cliServer')
const repo = await import('../collab/collabRepo')

const P = (o: Record<string, string | string[]>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) u.append(k, x); return u }
const dir = mkdtempSync(join(tmpdir(), 'tm-'))
const proj = join(dir, 'proj')
function seed(): void {
  mkdirSync(join(proj, 'docs'), { recursive: true })
  writeFileSync(join(proj, 'docs', 'notes.md'), '# Notes\nKeep it short.\n')
  writeFileSync(join(proj, '.env'), 'API_KEY=secret\n')
  writeFileSync(join(proj, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
  const d = testDb(); const now = Date.now()
  d.prepare(`INSERT INTO projects (id, name, folder_path, instructions, memory, created_at, last_opened_at) VALUES ('p-proj-0001', 'My project', ?, 'Be brief.', 'Tone: friendly.', ?, ?)`).run(proj, now, now)
}
async function chatWithReply(text: string, reply: string, actions: unknown[] = []): Promise<{ run: string; chat: string }> {
  const r = (await runCliCommand('send', P({ to: 'project', message: text }))).json as { run: string; chat: string }
  const b = busy.get(r.chat)!; busy.delete(r.chat)
  appendMessage({ conversationId: r.chat, role: 'assistant', provider: b.provider as never, content: reply, metadata: { actions } })
  return r
}

beforeEach(() => { resetTestDb(); seed(); busy.clear(); started.length = 0; fired.length = 0; collabCalls.length = 0; initRunLog(join(mkdtempSync(join(tmpdir(), 'rl-')), 'run-log.jsonl')) })

describe('runs and the run log (D-118)', () => {
  it('lists what finished since a time, newest first, filtered by project or source', async () => {
    const base = { kind: 'chat' as const, chat: 'c', title: 't', agents: ['claude-code'], error: null, files: [] }
    appendRunLog({ ...base, run: 'a', project: 'My project', source: 'schedule', startedAt: 1, finishedAt: Date.now() - 3 * 3600_000, state: 'done' })
    appendRunLog({ ...base, run: 'b', project: 'My project', source: 'cli', startedAt: 1, finishedAt: Date.now() - 600_000, state: 'error', error: 'Codex timed out' })
    appendRunLog({ ...base, run: 'c', project: 'Other', source: 'app', startedAt: 1, finishedAt: Date.now() - 60_000, state: 'done' })
    expect(readRunLog(0).map((e) => e.run)).toEqual(['c', 'b', 'a'])
    const r = await runCliCommand('runs', P({ since: '1h' }))
    expect((r.json as { run: string }[]).map((e) => e.run)).toEqual(['c', 'b'])
    expect(r.text).toContain('ERROR')
    expect(r.text).toContain('error: Codex timed out')
    expect(((await runCliCommand('runs', P({ since: '1d', project: 'project' }))).json as unknown[]).length).toBe(2)
    expect(((await runCliCommand('runs', P({ since: '1d', source: 'schedule' }))).json as unknown[]).length).toBe(1)
    expect((await runCliCommand('runs', P({ since: 'whenever' }))).status).toBe(400)
  })
})

describe('busy chats (D-118)', () => {
  it('a busy chat answers 409 at once, or --wait-free queues the message until the chat is free', async () => {
    const { chat } = (await runCliCommand('send', P({ to: 'project', message: 'one' }))).json as { chat: string }
    const r = await runCliCommand('send', P({ to: chat, message: 'two' }))
    expect(r.status).toBe(409)
    expect(r.text).toMatch(/--wait-free/)
    setTimeout(() => busy.delete(chat), 1200)
    const queued = await runCliCommand('send', P({ to: chat, message: 'two', waitfree: '10' }))
    expect(queued.status).toBe(200)
    expect(started.map((s) => s.text)).toEqual(['one', 'two'])
  })
})

describe('status lists the files a run changed (D-118)', () => {
  it('project-relative, once each, from file events and write tools only', async () => {
    const { run } = await chatWithReply('tidy the docs', 'Done.', [
      { kind: 'file', label: 'a.md', path: join(proj, 'docs', 'a.md'), at: 1 },
      { kind: 'tool', label: 'Edit', path: join(proj, 'docs', 'a.md'), at: 2 },
      { kind: 'tool', label: 'Read', path: join(proj, 'docs', 'b.md'), at: 3 },
      { kind: 'tool', label: 'Write', path: '/tmp/elsewhere.txt', at: 4 }
    ])
    const s = await runCliCommand('status', P({ run }))
    expect((s.json as { files: string[] }).files).toEqual(['docs/a.md', '/tmp/elsewhere.txt'])
    expect(s.text).toContain('Files changed (2):\n  docs/a.md')
  })
})

describe('rename and delete (D-118)', () => {
  it('renames any chat; deletes only chats started from the command line', async () => {
    const { chat } = await chatWithReply('test chat', 'ok')
    expect((await runCliCommand('rename', P({ chat, title: 'CLI test' }))).text).toBe('Renamed to "CLI test".')
    // a chat the user started in the app
    const d = testDb(); const now = Date.now()
    d.prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES ('app-chat-0001', 'p-proj-0001', 'Mine', 'claude-code', ?, ?)`).run(now, now)
    appendMessage({ conversationId: 'app-chat-0001', role: 'user', content: 'from the window' })
    const refused = await runCliCommand('delete', P({ chat: 'app-chat-0001' }))
    expect(refused.status).toBe(403)
    expect((await runCliCommand('delete', P({ chat }))).text).toBe('Deleted "CLI test".')
    expect((await runCliCommand('show', P({ chat }))).status).toBe(404)
  })
  it('refuses to delete a chat that is running', async () => {
    const { chat } = (await runCliCommand('send', P({ to: 'project', message: 'x' }))).json as { chat: string }
    expect((await runCliCommand('delete', P({ chat }))).status).toBe(409)
  })
})

describe('read-only project files (D-118)', () => {
  it('lists files without secrets and prints text files', async () => {
    const f = await runCliCommand('files', P({ project: 'project' }))
    expect(f.text).toContain('docs/notes.md')
    expect(f.text).not.toContain('.env')
    expect((await runCliCommand('cat', P({ project: 'project', path: 'docs/notes.md' }))).text).toBe('# Notes\nKeep it short.')
  })
  it('refuses secrets, binaries, missing files and paths outside the project', async () => {
    expect((await runCliCommand('cat', P({ project: 'project', path: '.env' }))).status).toBe(403)
    expect((await runCliCommand('cat', P({ project: 'project', path: 'logo.bin' }))).text).toMatch(/isn't a text file/)
    expect((await runCliCommand('cat', P({ project: 'project', path: 'nope.md' }))).status).toBe(404)
    expect((await runCliCommand('cat', P({ project: 'project', path: '../../etc/passwd' }))).status).toBe(403)
  })
})

describe('attachments (D-118)', () => {
  it('copies files into the project and passes text inline, images by path', async () => {
    const src = mkdtempSync(join(tmpdir(), 'att-'))
    writeFileSync(join(src, 'notes.txt'), 'draft outline')
    writeFileSync(join(src, 'screenshot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))
    const r = await runCliCommand('send', P({ to: 'project', message: 'see these', attach: [join(src, 'notes.txt'), join(src, 'screenshot.png')] }))
    expect(r.status).toBe(200)
    const atts = started[0].attachments as { path: string; content?: string; image?: boolean }[]
    expect(atts[0]).toMatchObject({ content: 'draft outline', viewable: true })
    expect(atts[1]).toMatchObject({ image: true })
    // D-126: in the new chat's own folder
    const chat = (r.json as { chat: string }).chat
    expect(atts[0].path.startsWith(`.workbench/attachments/${chat}/`)).toBe(true)
    expect(readdirSync(join(proj, '.workbench', 'attachments', chat)).length).toBe(2)
    expect(existsSync(join(proj, atts[1].path))).toBe(true)
  })
  it('refuses relative paths, missing files and credentials', async () => {
    expect((await runCliCommand('send', P({ to: 'project', message: 'x', attach: 'notes.txt' }))).text).toMatch(/must be absolute/)
    expect((await runCliCommand('send', P({ to: 'project', message: 'x', attach: '/nope/file.txt' }))).status).toBe(404)
    expect((await runCliCommand('send', P({ to: 'project', message: 'x', attach: join(proj, '.env') }))).text).toMatch(/credentials/)
    expect(started).toHaveLength(0)
  })
})

describe('search, context, schedules, --think (D-118)', () => {
  it('searches chats and shows project context read-only', async () => {
    await chatWithReply('release checklist idea', 'Add a smoke test.')
    expect((await runCliCommand('search', P({ query: 'checklist' }))).text).toContain('My project')
    const c = await runCliCommand('context', P({ project: 'project' }))
    expect(c.text).toContain('## Instructions\nBe brief.')
    expect(c.text).toContain('Tone: friendly.')
  })
  it('lists schedules and runs one now', async () => {
    const now = Date.now()
    testDb().prepare(`INSERT INTO schedules (id, project_id, title, prompt, provider, kind, interval_min, at_min, enabled, target, next_run_at, created_at) VALUES ('s-daily-01', 'p-proj-0001', 'Positive news', 'p', 'claude-code', 'daily', 0, 545, 1, 'new', ?, ?)`).run(now + 3600_000, now)
    const l = await runCliCommand('schedules', P({}))
    expect(l.text).toContain('Positive news · My project · Claude · Auto · daily at 09:05')
    const r = await runCliCommand('schedules', P({ do: 'run', task: 'positive' }))
    expect(r.status).toBe(200)
    expect(fired).toEqual(['s-daily-01'])
  })
  it('passes a thinking mode and refuses unknown ones', async () => {
    await runCliCommand('send', P({ to: 'project', message: 'tea vs coffee', think: 'debate' }))
    expect(started[0]).toMatchObject({ mode: 'debate' })
    expect((await runCliCommand('send', P({ to: 'project', message: 'x', think: 'vibes' }))).status).toBe(400)
  })
})

describe('scheduled tasks from the command line (D-134)', () => {
  const get = (id: string) => testDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Record<string, unknown> | undefined
  const appTask = (id: string, mode: string, managed = 0) => testDb().prepare(`INSERT INTO schedules (id, project_id, title, prompt, provider, permission_mode, kind, interval_min, at_min, enabled, target, next_run_at, created_at, bot_managed) VALUES (?, 'p-proj-0001', ?, 'secret prompt', 'claude-code', ?, 'daily', 60, 540, 1, 'new', ?, ?, ?)`).run(id, `Task ${id}`, mode, Date.now() + 3600_000, Date.now(), managed)

  it('a bot\'s new task is paused, handed over and waits for approval; it can\'t run until then', async () => {
    const r = await runCliCommand('schedules', P({ do: 'add', project: 'project', title: 'Morning brief', prompt: 'Summarise yesterday', daily: '08:30', mode: 'read' }))
    expect(r.status).toBe(200)
    expect(r.text).toMatch(/paused until you approve it/)
    const id = (r.json as { id: string }).id
    expect(get(id)).toMatchObject({ enabled: 0, created_via: 'cli', bot_managed: 1, permission_mode: 'read', at_min: 510 })
    expect(JSON.parse(String(get(id)!.pending))).toMatchObject({ kind: 'new' })
    expect((await runCliCommand('schedules', P({ do: 'run', task: id }))).status).toBe(403)
    expect((await runCliCommand('schedules', P({ do: 'resume', task: id }))).status).toBe(403)
    expect((await runCliCommand('schedules', P({}))).text).toContain('[waiting for approval, bots can manage] Morning brief')
  })
  it('refuses Full access, too-frequent runs and missing parts', async () => {
    expect((await runCliCommand('schedules', P({ do: 'add', project: 'project', title: 'x', prompt: 'y', every: '2h', mode: 'full' }))).status).toBe(400)
    expect((await runCliCommand('schedules', P({ do: 'add', project: 'project', title: 'x', prompt: 'y', every: '5m' }))).status).toBe(403)
    expect((await runCliCommand('schedules', P({ do: 'add', project: 'project', title: 'x', prompt: 'y' }))).text).toMatch(/--daily|--every/)
  })
  it('your own tasks: run, pause and resume yes; edit, delete and the prompt no', async () => {
    appTask('s-app-0001', 'auto')
    expect((await runCliCommand('schedules', P({ do: 'pause', task: 's-app-0001' }))).status).toBe(200)
    expect(get('s-app-0001')!.enabled).toBe(0)
    expect((await runCliCommand('schedules', P({ do: 'resume', task: 's-app-0001' }))).status).toBe(200)
    expect((await runCliCommand('schedules', P({ do: 'edit', task: 's-app-0001', prompt: 'do something else' }))).status).toBe(403)
    expect((await runCliCommand('schedules', P({ do: 'delete', task: 's-app-0001' }))).status).toBe(403)
    const show = await runCliCommand('schedules', P({ do: 'show', task: 's-app-0001' }))
    expect(show.text).not.toContain('secret prompt')
    expect(show.text).toContain('not handed over')
  })
  it('handed-over task: edits apply, the mode never rises, delete works', async () => {
    appTask('s-bot-0001', 'read', 1)
    expect((await runCliCommand('schedules', P({ do: 'edit', task: 's-bot-0001', mode: 'auto' }))).status).toBe(403)
    const e = await runCliCommand('schedules', P({ do: 'edit', task: 's-bot-0001', prompt: 'new words', every: '30m' }))
    expect(e.status).toBe(200)
    expect(get('s-bot-0001')).toMatchObject({ prompt: 'new words', kind: 'interval', interval_min: 30, pending: null })
    expect((await runCliCommand('schedules', P({ do: 'show', task: 's-bot-0001' }))).text).toContain('new words')
    expect((await runCliCommand('schedules', P({ do: 'delete', task: 's-bot-0001' }))).status).toBe(200)
    expect(get('s-bot-0001')).toBeUndefined()
  })
  it('handed-over Full-access task: lowering applies; other edits and delete wait for you; Approve / Discard', async () => {
    appTask('s-full-0001', 'full', 1)
    const e = await runCliCommand('schedules', P({ do: 'edit', task: 's-full-0001', prompt: 'rm everything' }))
    expect(e.text).toMatch(/waits for approval/)
    expect(get('s-full-0001')).toMatchObject({ prompt: 'secret prompt', enabled: 0 })
    expect((await runCliCommand('schedules', P({ do: 'edit', task: 's-full-0001', mode: 'auto' }))).status).toBe(403)   // a change already waits
    const { reviewSchedule } = await import('../schedules/scheduleChanges')
    reviewSchedule('s-full-0001', false)                                      // Discard
    expect(get('s-full-0001')).toMatchObject({ prompt: 'secret prompt', enabled: 1, pending: null })
    await runCliCommand('schedules', P({ do: 'edit', task: 's-full-0001', title: 'Renamed' }))
    reviewSchedule('s-full-0001', true)                                       // Approve
    expect(get('s-full-0001')).toMatchObject({ title: 'Renamed', enabled: 1, pending: null })
    expect((await runCliCommand('schedules', P({ do: 'edit', task: 's-full-0001', mode: 'auto' }))).text).toMatch(/Updated/)   // lowering: at once
    expect(get('s-full-0001')!.permission_mode).toBe('auto')
    testDb().prepare("UPDATE schedules SET permission_mode = 'full' WHERE id = 's-full-0001'").run()
    expect((await runCliCommand('schedules', P({ do: 'delete', task: 's-full-0001' }))).text).toMatch(/waits for you to confirm/)
    reviewSchedule('s-full-0001', true)
    expect(get('s-full-0001')).toBeUndefined()
  })
})

describe('Collab from the command line (D-118)', () => {
  it('starts, shows the plan, approves; fixes and recovery go to the orchestrator', async () => {
    const s = await runCliCommand('collab', P({ do: 'start', project: 'project', goal: 'Draft a project checklist', mode: 'auto' }))
    expect(s.status).toBe(200)
    const run = (s.json as { run: string }).run
    expect(s.text).toContain('awaiting confirmation')
    expect(s.text).toContain('troupe collab approve')
    expect(readRunLog(0)[0]).toMatchObject({ kind: 'collab', source: 'cli', state: 'started' })
    expect((await runCliCommand('collab', P({ do: 'approve', run }))).json).toMatchObject({ status: 'running' })
    expect((await runCliCommand('collab', P({ do: 'approve', run }))).status).toBe(409)
    // paused with a task and a Planner fix
    repo.replaceTasks(run, [{ title: 'Write sheet', scope: 'out/sheet.csv' }])
    repo.updateCollabRun(run, { status: 'needs_attention', reason: 'Task 1 failed twice', repair: { taskId: 'x', summary: 's', recommended: 0, options: [{ label: 'Retry with clearer columns', action: 'retry', changesGoal: false }] } })
    const st = await runCliCommand('collab', P({ do: 'status', run }))
    expect(st.text).toContain('1. [pending] Write sheet')
    expect(st.text).toContain('1. Retry with clearer columns (recommended)')
    await runCliCommand('collab', P({ do: 'fix', run, n: '1' }))
    await runCliCommand('collab', P({ do: 'retry', run, task: '1', note: 'use ISO dates' }))
    expect(collabCalls).toEqual(['start', 'confirm', 'repair:0', expect.stringMatching(/^recover:.+:retry:use ISO dates$/)])
    expect((await runCliCommand('collab', P({ do: 'fix', run, n: '5' }))).status).toBe(409)
    // `runs` reports the run's state now, not the 'started' line logged at the start
    expect((await runCliCommand('runs', P({ since: '1d' }))).json).toMatchObject([{ run, state: 'paused', error: 'Task 1 failed twice' }])
    repo.updateCollabRun(run, { status: 'done', repair: null })
    const done = await runCliCommand('runs', P({ since: '1d' }))
    expect(done.json).toMatchObject([{ run, state: 'done' }])
    expect(done.text).toMatch(/done\s+cli/)
    expect((await runCliCommand('collab', P({ do: 'start', project: 'project', goal: 'x', mode: 'full' }))).status).toBe(400)
  })
})

describe.skipIf(process.platform === 'win32')('troupe script, new commands over the socket (D-118)', () => {
  const sock = join(mkdtempSync(join(tmpdir(), 'ts-')), 's.sock')
  const script = fileURLToPath(new URL('../../../resources/troupe', import.meta.url))
  const troupe = (args: string[], cwd?: string): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
    execFile('/bin/bash', [script, ...args], { cwd, env: { ...process.env, TROUPE_SOCKET: sock } }, (e, out, err) =>
      resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out, err }))
  })
  it('busy is exit code 4; relative --attach paths resolve from the caller; cat and files work', async () => {
    await startCliServer(sock)
    const src = mkdtempSync(join(tmpdir(), 'cwd-')); writeFileSync(join(src, 'brief.md'), 'the brief')
    const first = await troupe(['send', 'project', 'one', '--attach', 'brief.md', '--json'], src)
    expect(first.code).toBe(0)
    expect((started[0].attachments as { content: string }[])[0].content).toBe('the brief')
    const { chat } = JSON.parse(first.out)
    const again = await troupe(['send', chat, 'two'])
    expect(again.code).toBe(4)
    expect(again.err).toMatch(/already running/)
    expect((await troupe(['cat', 'project', 'docs/notes.md'])).out).toBe('# Notes\nKeep it short.\n')
    expect((await troupe(['files', 'project', 'docs'])).out).toContain('docs/notes.md')
    expect((await troupe(['collab', 'frobnicate', 'x'])).code).toBe(2)
    expect(readFileSync(script, 'utf8')).toContain('4 chat busy')
  })
})

describe('Windows troupe client and token (D-120)', () => {
  // A named pipe on Windows, a Unix socket elsewhere — same server and client code.
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\troupe-test-${process.pid}` : join(mkdtempSync(join(tmpdir(), 'tw-')), 'p.sock')
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'tk-')), 'cli-token')
  const client = fileURLToPath(new URL('../../../resources/troupe-cli.mjs', import.meta.url))
  const troupe = (args: string[], cwd?: string, input?: string): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
    const c = execFile(process.execPath, [client, ...args], { cwd, env: { ...process.env, TROUPE_PIPE: sock, TROUPE_TOKEN_FILE: tokenFile } }, (e, out, err) =>
      resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out, err }))
    if (input !== undefined) c.stdin?.end(input)
  })
  it('needs the token; same commands, output and exit codes as the bash script', async () => {
    const { stopCliServer } = await import('./cliServer')
    stopCliServer()
    await startCliServer(sock, { token: 'right-token', pipe: process.platform === 'win32' })
    expect((await troupe(['projects'])).code).toBe(3)                     // no token file: not reachable
    writeFileSync(tokenFile, 'wrong-token')
    const denied = await troupe(['projects'])
    expect(denied.code).toBe(1); expect(denied.err).toMatch(/not allowed/)
    writeFileSync(tokenFile, 'right-token\n')
    const list = await troupe(['projects'])
    expect(list.code).toBe(0); expect(list.out).toContain('My project')
    expect((await troupe(['cat', 'project', 'docs/notes.md'])).out).toBe('# Notes\nKeep it short.\n')
    expect((await troupe(['frobnicate'])).code).toBe(2)
    const piped = await troupe(['send', 'project', '-', '--json', '--new'], undefined, 'from stdin')
    expect(piped.code).toBe(0)
    const { chat } = JSON.parse(piped.out)
    expect(started.some((s) => s.text === 'from stdin')).toBe(true)
    expect((await troupe(['send', chat, 'again'])).code).toBe(4)

    // A refresh while open (Settings ▸ Save) brings a new token: the open server must take it.
    await startCliServer(sock, { token: 'second-token', pipe: process.platform === 'win32' })
    writeFileSync(tokenFile, 'second-token')
    expect((await troupe(['projects'])).code).toBe(0)
    writeFileSync(tokenFile, 'right-token')
    expect((await troupe(['projects'])).code).toBe(1)
    writeFileSync(tokenFile, 'second-token')

    // The installed wrapper (troupe.cmd → troupe-run.ps1 → client): on Windows through cmd, elsewhere
    // the .ps1 under pwsh when it's installed. Node stands in for Troupe.exe.
    const { installCommandWin, WIN_ARGS_MARK } = await import('./cliInstall')
    const binDir = mkdtempSync(join(tmpdir(), 'tb-'))
    const inst = installCommandWin(process.execPath, client, sock, tokenFile, binDir, '')
    const win = process.platform === 'win32'
    const pwsh = win ? null : (process.env.PATH ?? '').split(':').map((d) => join(d, 'pwsh')).find((f) => existsSync(f))
    if (win || pwsh) {
      const run = (args: string[], input?: string): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
        const [file, pre] = win ? ['cmd.exe', ['/d', '/c', inst.path]] : [pwsh!, ['-NoProfile', '-Command', "& (Join-Path $env:TROUPE_BIN 'troupe-run.ps1'); exit $LASTEXITCODE", WIN_ARGS_MARK]]   // what troupe.cmd runs
        const c = execFile(file, [...pre, ...args], { env: { ...process.env, TROUPE_BIN: binDir + '/' } }, (e, out, err) =>
          resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out, err }))
        if (input !== undefined) c.stdin?.end(input); else c.stdin?.end()
      })
      // A tool that leaves stdin open must not hang the wrapper (only `send … -` reads it).
      const open = await new Promise<number>((resolve) => {
        const [file, pre] = win ? ['cmd.exe', ['/d', '/c', inst.path]] : [pwsh!, ['-NoProfile', '-Command', "& (Join-Path $env:TROUPE_BIN 'troupe-run.ps1'); exit $LASTEXITCODE", WIN_ARGS_MARK]]   // what troupe.cmd runs
        const c = execFile(file, [...pre, 'projects'], { timeout: 15000, env: { ...process.env, TROUPE_BIN: binDir + '/' } }, (e) => resolve(e ? 1 : 0))
        void c   // stdin deliberately left open
      })
      expect(open).toBe(0)
      const w = await run(['projects'])
      expect(w.code).toBe(0); expect(w.out).toContain('My project')
      const r = await run(['search', 'say "60/40" now', '--json'])
      expect(r.code).toBe(0)
      expect((await run(['frobnicate'])).code).toBe(2)
      const s2 = await run(['send', 'project', '-', '--new', '--json'], 'piped through the wrapper')
      expect(s2.code).toBe(0)
      expect(started.some((x) => x.text === 'piped through the wrapper')).toBe(true)
    }
    stopCliServer()
  }, 30_000)   // spawns the client a dozen times (and pwsh when present)
})
