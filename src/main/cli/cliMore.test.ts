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
  writeFileSync(join(proj, 'docs', 'portfolio-management.md'), '# Portfolio\nHold 60/40.\n')
  writeFileSync(join(proj, '.env'), 'API_KEY=secret\n')
  writeFileSync(join(proj, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
  const d = testDb(); const now = Date.now()
  d.prepare(`INSERT INTO projects (id, name, folder_path, instructions, memory, created_at, last_opened_at) VALUES ('p-fin-0001', 'Personal finance', ?, 'Be brief.', 'Risk: moderate.', ?, ?)`).run(proj, now, now)
}
async function chatWithReply(text: string, reply: string, actions: unknown[] = []): Promise<{ run: string; chat: string }> {
  const r = (await runCliCommand('send', P({ to: 'finance', message: text }))).json as { run: string; chat: string }
  const b = busy.get(r.chat)!; busy.delete(r.chat)
  appendMessage({ conversationId: r.chat, role: 'assistant', provider: b.provider as never, content: reply, metadata: { actions } })
  return r
}

beforeEach(() => { resetTestDb(); seed(); busy.clear(); started.length = 0; fired.length = 0; collabCalls.length = 0; initRunLog(join(mkdtempSync(join(tmpdir(), 'rl-')), 'run-log.jsonl')) })

describe('runs and the run log (D-118)', () => {
  it('lists what finished since a time, newest first, filtered by project or source', async () => {
    const base = { kind: 'chat' as const, chat: 'c', title: 't', agents: ['claude-code'], error: null, files: [] }
    appendRunLog({ ...base, run: 'a', project: 'Personal finance', source: 'schedule', startedAt: 1, finishedAt: Date.now() - 3 * 3600_000, state: 'done' })
    appendRunLog({ ...base, run: 'b', project: 'Personal finance', source: 'cli', startedAt: 1, finishedAt: Date.now() - 600_000, state: 'error', error: 'Codex timed out' })
    appendRunLog({ ...base, run: 'c', project: 'Other', source: 'app', startedAt: 1, finishedAt: Date.now() - 60_000, state: 'done' })
    expect(readRunLog(0).map((e) => e.run)).toEqual(['c', 'b', 'a'])
    const r = await runCliCommand('runs', P({ since: '1h' }))
    expect((r.json as { run: string }[]).map((e) => e.run)).toEqual(['c', 'b'])
    expect(r.text).toContain('ERROR')
    expect(r.text).toContain('error: Codex timed out')
    expect(((await runCliCommand('runs', P({ since: '1d', project: 'finance' }))).json as unknown[]).length).toBe(2)
    expect(((await runCliCommand('runs', P({ since: '1d', source: 'schedule' }))).json as unknown[]).length).toBe(1)
    expect((await runCliCommand('runs', P({ since: 'whenever' }))).status).toBe(400)
  })
})

describe('busy chats (D-118)', () => {
  it('a busy chat answers 409 at once, or --wait-free queues the message until the chat is free', async () => {
    const { chat } = (await runCliCommand('send', P({ to: 'finance', message: 'one' }))).json as { chat: string }
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
    const { run } = await chatWithReply('rebalance', 'Done.', [
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
    d.prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES ('app-chat-0001', 'p-fin-0001', 'Mine', 'claude-code', ?, ?)`).run(now, now)
    appendMessage({ conversationId: 'app-chat-0001', role: 'user', content: 'from the window' })
    const refused = await runCliCommand('delete', P({ chat: 'app-chat-0001' }))
    expect(refused.status).toBe(403)
    expect((await runCliCommand('delete', P({ chat }))).text).toBe('Deleted "CLI test".')
    expect((await runCliCommand('show', P({ chat }))).status).toBe(404)
  })
  it('refuses to delete a chat that is running', async () => {
    const { chat } = (await runCliCommand('send', P({ to: 'finance', message: 'x' }))).json as { chat: string }
    expect((await runCliCommand('delete', P({ chat }))).status).toBe(409)
  })
})

describe('read-only project files (D-118)', () => {
  it('lists files without secrets and prints text files', async () => {
    const f = await runCliCommand('files', P({ project: 'finance' }))
    expect(f.text).toContain('docs/portfolio-management.md')
    expect(f.text).not.toContain('.env')
    expect((await runCliCommand('cat', P({ project: 'finance', path: 'docs/portfolio-management.md' }))).text).toBe('# Portfolio\nHold 60/40.')
  })
  it('refuses secrets, binaries, missing files and paths outside the project', async () => {
    expect((await runCliCommand('cat', P({ project: 'finance', path: '.env' }))).status).toBe(403)
    expect((await runCliCommand('cat', P({ project: 'finance', path: 'logo.bin' }))).text).toMatch(/isn't a text file/)
    expect((await runCliCommand('cat', P({ project: 'finance', path: 'nope.md' }))).status).toBe(404)
    expect((await runCliCommand('cat', P({ project: 'finance', path: '../../etc/passwd' }))).status).toBe(403)
  })
})

describe('attachments (D-118)', () => {
  it('copies files into the project and passes text inline, images by path', async () => {
    const src = mkdtempSync(join(tmpdir(), 'att-'))
    writeFileSync(join(src, 'notes.txt'), 'buy VTI')
    writeFileSync(join(src, 'ssi.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))
    const r = await runCliCommand('send', P({ to: 'finance', message: 'see these', attach: [join(src, 'notes.txt'), join(src, 'ssi.png')] }))
    expect(r.status).toBe(200)
    const atts = started[0].attachments as { path: string; content?: string; image?: boolean }[]
    expect(atts[0]).toMatchObject({ content: 'buy VTI', viewable: true })
    expect(atts[1]).toMatchObject({ image: true })
    expect(readdirSync(join(proj, '.workbench', 'attachments')).length).toBe(2)
    expect(existsSync(join(proj, atts[1].path))).toBe(true)
  })
  it('refuses relative paths, missing files and credentials', async () => {
    expect((await runCliCommand('send', P({ to: 'finance', message: 'x', attach: 'notes.txt' }))).text).toMatch(/must be absolute/)
    expect((await runCliCommand('send', P({ to: 'finance', message: 'x', attach: '/nope/file.txt' }))).status).toBe(404)
    expect((await runCliCommand('send', P({ to: 'finance', message: 'x', attach: join(proj, '.env') }))).text).toMatch(/credentials/)
    expect(started).toHaveLength(0)
  })
})

describe('search, context, schedules, --think (D-118)', () => {
  it('searches chats and shows project context read-only', async () => {
    await chatWithReply('portfolio rebalance idea', 'Shift to bonds.')
    expect((await runCliCommand('search', P({ query: 'rebalance' }))).text).toContain('Personal finance')
    const c = await runCliCommand('context', P({ project: 'finance' }))
    expect(c.text).toContain('## Instructions\nBe brief.')
    expect(c.text).toContain('Risk: moderate.')
  })
  it('lists schedules and runs one now', async () => {
    const now = Date.now()
    testDb().prepare(`INSERT INTO schedules (id, project_id, title, prompt, provider, kind, interval_min, at_min, enabled, target, next_run_at, created_at) VALUES ('s-daily-01', 'p-fin-0001', 'Positive news', 'p', 'claude-code', 'daily', 0, 545, 1, 'new', ?, ?)`).run(now + 3600_000, now)
    const l = await runCliCommand('schedules', P({}))
    expect(l.text).toContain('Positive news · Personal finance · Claude · daily at 09:05')
    const r = await runCliCommand('schedules', P({ do: 'run', task: 'positive' }))
    expect(r.status).toBe(200)
    expect(fired).toEqual(['s-daily-01'])
  })
  it('passes a thinking mode and refuses unknown ones', async () => {
    await runCliCommand('send', P({ to: 'finance', message: 'stocks vs bonds', think: 'debate' }))
    expect(started[0]).toMatchObject({ mode: 'debate' })
    expect((await runCliCommand('send', P({ to: 'finance', message: 'x', think: 'vibes' }))).status).toBe(400)
  })
})

describe('Collab from the command line (D-118)', () => {
  it('starts, shows the plan, approves; fixes and recovery go to the orchestrator', async () => {
    const s = await runCliCommand('collab', P({ do: 'start', project: 'finance', goal: 'Build a rebalancing sheet', mode: 'auto' }))
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
    expect((await runCliCommand('collab', P({ do: 'start', project: 'finance', goal: 'x', mode: 'full' }))).status).toBe(400)
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
    const first = await troupe(['send', 'finance', 'one', '--attach', 'brief.md', '--json'], src)
    expect(first.code).toBe(0)
    expect((started[0].attachments as { content: string }[])[0].content).toBe('the brief')
    const { chat } = JSON.parse(first.out)
    const again = await troupe(['send', chat, 'two'])
    expect(again.code).toBe(4)
    expect(again.err).toMatch(/already running/)
    expect((await troupe(['cat', 'finance', 'docs/portfolio-management.md'])).out).toBe('# Portfolio\nHold 60/40.\n')
    expect((await troupe(['files', 'finance', 'docs'])).out).toContain('docs/portfolio-management.md')
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
    expect(list.code).toBe(0); expect(list.out).toContain('Personal finance')
    expect((await troupe(['cat', 'finance', 'docs/portfolio-management.md'])).out).toBe('# Portfolio\nHold 60/40.\n')
    expect((await troupe(['frobnicate'])).code).toBe(2)
    const piped = await troupe(['send', 'finance', '-', '--json', '--new'], undefined, 'from stdin')
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
    const { installCommandWin } = await import('./cliInstall')
    const binDir = mkdtempSync(join(tmpdir(), 'tb-'))
    const inst = installCommandWin(process.execPath, client, sock, tokenFile, binDir, '')
    const win = process.platform === 'win32'
    const pwsh = win ? null : (process.env.PATH ?? '').split(':').map((d) => join(d, 'pwsh')).find((f) => existsSync(f))
    if (win || pwsh) {
      const run = (args: string[], input?: string): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
        const [file, pre] = win ? ['cmd.exe', ['/d', '/c', inst.path]] : [pwsh!, ['-NoProfile', '-File', join(binDir, 'troupe-run.ps1')]]
        const c = execFile(file, [...pre, ...args], (e, out, err) =>
          resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out, err }))
        if (input !== undefined) c.stdin?.end(input); else c.stdin?.end()
      })
      // A tool that leaves stdin open must not hang the wrapper (only `send … -` reads it).
      const open = await new Promise<number>((resolve) => {
        const [file, pre] = win ? ['cmd.exe', ['/d', '/c', inst.path]] : [pwsh!, ['-NoProfile', '-File', join(binDir, 'troupe-run.ps1')]]
        const c = execFile(file, [...pre, 'projects'], { timeout: 15000 }, (e) => resolve(e ? 1 : 0))
        void c   // stdin deliberately left open
      })
      expect(open).toBe(0)
      const w = await run(['projects'])
      expect(w.code).toBe(0); expect(w.out).toContain('Personal finance')
      const r = await run(['search', 'say "60/40" now', '--json'])
      expect(r.code).toBe(0)
      expect((await run(['frobnicate'])).code).toBe(2)
      const s2 = await run(['send', 'finance', '-', '--new', '--json'], 'piped through the wrapper')
      expect(s2.code).toBe(0)
      expect(started.some((x) => x.text === 'piped through the wrapper')).toBe(true)
    }
    stopCliServer()
  }, 30_000)   // spawns the client a dozen times (and pwsh when present)
})
