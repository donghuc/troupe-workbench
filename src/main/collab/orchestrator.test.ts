import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetTestDb, testDb } from '../testing/memoryDb'

// D-121: the Collab orchestrator end to end, with the agent runs faked: each startRun is
// recorded and the test plays the agent by writing its reply and calling onDone.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: false },
  BrowserWindow: { getAllWindows: () => [{ webContents: { isDestroyed: () => false, send: () => {} } }] },
  Notification: class { static isSupported() { return false } },
  powerSaveBlocker: { start: () => 1, stop: () => {} }
}))
vi.mock('../database/db', () => ({ getDb: () => testDb() }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
vi.mock('../tools/codexModels', () => ({ modelLists: () => ({}) }))
vi.mock('../providers/registry', () => ({ createProvider: () => ({ getCapabilities: () => ({ fileWrite: true, shell: true, web: true }) }) }))
vi.mock('../schedules/scheduler', () => ({ runScheduleNow: () => {} }))
interface Started { id: string; params: { conversationId: string; prompt: string; timeoutMs: number; extraMetadata?: Record<string, unknown>; parallelGroup?: string; onDone?: (mid: string | null, err?: string) => void } }
const runs: Started[] = []
const cancelled: string[] = []
vi.mock('../agent/runner', () => ({
  startRun: (_s: unknown, params: Started['params']) => { const id = `r${runs.length + 1}`; runs.push({ id, params }); return id },
  cancelRun: async (id: string) => { cancelled.push(id) },
  runTimeoutMs: () => 60_000
}))
const locks = new Map<string, string>()
vi.mock('../agent/turns', () => ({
  acquireLock: (c: string, h: string) => { const cur = locks.get(c); if (cur && cur !== h) return false; locks.set(c, h); return true },
  releaseLock: (c: string, h: string) => { if (locks.get(c) === h) locks.delete(c) },
  isBusy: () => false, startTurn: () => {}, cancelTurn: async () => {},
  getTurnState: (id: string) => ({ conversationId: id, busy: false, parallel: false, error: null, rev: 0, lanes: [] })
}))

const orch = await import('./orchestrator')
const repo = await import('./collabRepo')
const { appendMessage, listMessages } = await import('../conversations/messagesRepo')
const { createConversation } = await import('../conversations/conversationsRepo')
const { runCliCommand } = await import('../cli/cliCommands')

const sender = { isDestroyed: () => false, send: () => {} } as never
const P = (o: Record<string, string>) => new URLSearchParams(o)
let proj = ''
let chat = ''

function seed(): void {
  proj = mkdtempSync(join(tmpdir(), 'collab-'))
  const now = Date.now()
  testDb().prepare(`INSERT INTO projects (id, name, folder_path, instructions, memory, created_at, last_opened_at) VALUES ('p-quiz-0001', 'Quiz', ?, '', '', ?, ?)`).run(proj, now, now)
  chat = createConversation('p-quiz-0001', 'Collab', 'claude-code').id
}
/** Play the agent of the latest run: write `files`, post `reply`, finish. */
function finish(reply: string, files: Record<string, string> = {}): Started {
  const r = runs[runs.length - 1]
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(proj, p, '..'), { recursive: true }); writeFileSync(join(proj, p), c) }
  const m = appendMessage({ conversationId: r.params.conversationId, role: 'assistant', provider: 'claude-code', content: reply, metadata: { ...(r.params.extraMetadata ?? {}), parallelGroup: r.params.parallelGroup } })
  r.params.onDone!(m.id)
  return r
}
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'
const role = (r: Started) => (r.params.extraMetadata?.collab as { role: string }).role
const plan = (tasks: unknown[], extra: Record<string, unknown> = {}) => json({ outputDir: 'quiz', tasks, ...extra })
const handoff = json({ status: 'done', filesChanged: ['quiz/q.md'], verify: 'read it' })
const PASS = json({ verdict: 'PASS', findings: [] })

function start(goal = 'Write a 5-question quiz'): string {
  return orch.startCollab(sender, { conversationId: chat, cwd: proj, providerId: 'claude-code', goal }).id
}
const TWO = [
  { title: 'Write the quiz', kind: 'work', scope: 'quiz/q.md', acceptance: '5 questions', dependsOn: [] },
  { title: 'Final review', kind: 'review', scope: '', acceptance: 'meets the goal', dependsOn: [0] }
]

beforeEach(() => { resetTestDb(); seed(); runs.length = 0; cancelled.length = 0; locks.clear() })

describe('Collab orchestrator (D-121)', () => {
  it('tags every agent run, sizes the budget to the plan, and ends with the Planner wrap-up', () => {
    const id = start()
    expect(role(runs[0])).toBe('planner')
    expect(runs[0].params.timeoutMs).toBe(90_000)               // 1.5 × the run timeout, not 3×
    finish(plan(TWO))
    expect(repo.getCollabRun(id)!.status).toBe('awaiting_confirmation')
    orch.confirmPlan(sender, id)
    expect(repo.getCollabRun(id)!.budget.maxRuns).toBeGreaterThanOrEqual(24)
    expect(role(runs[1])).toBe('maker')
    expect(runs[1].params.prompt).toContain('**Run goal (context):** Write a 5-question quiz')
    expect(runs[1].params.extraMetadata).toEqual({ collab: { runId: id, role: 'maker', task: 1, title: 'Write the quiz' } })
    finish(handoff, { 'quiz/q.md': '1. a\n2. b\n3. c\n4. d\n5. e\n' })
    expect(role(runs[2])).toBe('reviewer')
    finish(PASS)
    expect(role(runs[3])).toBe('reviewer')                       // final review
    finish(PASS)
    expect(role(runs[4])).toBe('wrapup')
    expect(repo.getCollabRun(id)!.status).toBe('running')        // still writing the wrap-up
    finish('## Outcome\nA five-question quiz in quiz/q.md, reviewed.\n\n## Files\n- `quiz/q.md` — the quiz\n\n## Decisions for you\n- None\n\n## Follow-ups\n- None')
    const done = repo.getCollabRun(id)!
    expect(done.status).toBe('done')
    expect(done.summary).toBe('Completed 2/2 tasks')                // plain text; the story is in the wrap-up
    const t = done.tasks![0]
    expect(t.meta.startedAt).toBeTypeOf('number')
    expect(t.meta.finishedAt).toBeGreaterThanOrEqual(t.meta.startedAt!)
    expect(locks.size).toBe(0)
    expect(readFileSync(join(proj, '.workbench', 'collab', id, 'STATUS.md'), 'utf8')).toContain('wrap-up')
  })

  it('shows plan checks and the Planner’s goal conflicts before approval; a big plan gets a bigger budget', () => {
    const id = start('Write 5 questions, but only 4')
    const tasks = Array.from({ length: 8 }, (_, i) => ({ title: `Part ${i + 1}`, kind: 'work', scope: i === 0 ? 'answers.md' : `quiz/p${i}.md`, acceptance: 'ok', dependsOn: [] }))
    finish(plan(tasks, { conflicts: ['The goal asks for 5 questions but also says only 4.'] }))
    const r = repo.getCollabRun(id)!
    expect(r.reason.split('\n')[0]).toBe('The goal asks for 5 questions but also says only 4.')
    expect(r.reason).toMatch(/`answers\.md` outside the deliverables folder `quiz\/` — in the project root/)
    expect(r.reason).toMatch(/no final review task/)
    orch.confirmPlan(sender, id)
    const after = repo.getCollabRun(id)!
    expect(after.reason).toBe('')
    expect(after.budget.maxRuns).toBeGreaterThan(24)
  })

  it('fails a Maker that says done but left its file unchanged, without spending a Reviewer run', () => {
    mkdirSync(join(proj, 'quiz')); writeFileSync(join(proj, 'quiz', 'q.md'), 'old\n')
    const id = start()
    finish(plan(TWO)); orch.confirmPlan(sender, id)
    finish(handoff)                                                // writes nothing
    const t = repo.getCollabRun(id)!.tasks![0]
    expect(t.lastVerdict?.findings[0]).toMatch(/No changes were written: `quiz\/q\.md` is exactly as before/)
    expect(role(runs[runs.length - 1])).toBe('maker')              // straight back to the Maker
    expect(runs.filter((r) => role(r) === 'reviewer')).toHaveLength(0)
  })

  it('a failed final review asks the Planner which task to redo; rework resets both tasks', () => {
    const id = start()
    finish(plan(TWO)); orch.confirmPlan(sender, id)
    finish(handoff, { 'quiz/q.md': '1. a\n' }); finish(PASS)
    finish(json({ verdict: 'FAIL', findings: ['Only 1 question; the goal asks for 5.'] }))
    expect(role(runs[runs.length - 1])).toBe('repair')
    expect(runs[runs.length - 1].params.prompt).toContain('FINAL review of the whole result')
    expect(runs[runs.length - 1].params.prompt).toMatch(/`quiz\/q\.md` — \d+ bytes/)
    finish(json({ summary: 'The quiz is short.', recommended: 0, options: [{ label: 'Redo T1 with the findings', action: 'rework', task: 1, changesGoal: false, note: 'Write all 5 questions' }] }))
    const paused = repo.getCollabRun(id)!
    expect(paused.status).toBe('needs_attention')
    expect(paused.repair!.options[0]).toMatchObject({ action: 'rework', taskSeq: 0 })
    orch.applyRepair(sender, id, 0)
    const r = repo.getCollabRun(id)!
    expect(r.status).toBe('running')
    expect(r.tasks!.map((t) => t.status)).toEqual(['in_progress', 'pending'])
    const maker = runs[runs.length - 1]
    expect(role(maker)).toBe('maker')
    expect(maker.params.prompt).toContain('Only 1 question; the goal asks for 5.')
    expect(maker.params.prompt).toContain('Write all 5 questions')
  })

  it('a goal fix changes the goal only when the user applies it', () => {
    const id = start('Write 5 questions, but only 4')
    finish(plan([TWO[0]])); orch.confirmPlan(sender, id)
    finish(json({ status: 'blocked', filesChanged: [], verify: 'the goal contradicts itself' }), { 'quiz/q.md': 'x' })
    expect(role(runs[runs.length - 1])).toBe('repair')
    finish(json({ summary: 'The goal contradicts itself.', recommended: 0, options: [{ label: 'Ask for 5 questions', action: 'retry', changesGoal: true, goal: 'Write a 5-question quiz', note: 'write 5' }] }))
    const paused = repo.getCollabRun(id)!
    expect(paused.status).toBe('needs_attention')                   // never applied automatically
    expect(paused.goal).toBe('Write 5 questions, but only 4')
    orch.applyRepair(sender, id, 0)
    expect(repo.getCollabRun(id)!.goal).toBe('Write a 5-question quiz')
    expect(runs[runs.length - 1].params.prompt).toContain('**Run goal (context):** Write a 5-question quiz')
  })

  it('`troupe collab stop` on a paused run answers at once, and the run gets a wrap-up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const id = start()
      finish(plan(TWO)); orch.confirmPlan(sender, id)
      finish(json({ status: 'done', filesChanged: [], verify: '' }))     // file missing → back to Maker
      finish(json({ status: 'done', filesChanged: [], verify: '' }))
      finish(json({ status: 'done', filesChanged: [], verify: '' }))
      expect(repo.getCollabRun(id)!.status).toBe('needs_attention')
      const t0 = Date.now()
      const r = await runCliCommand('collab', P({ do: 'stop', run: id }))
      expect(Date.now() - t0).toBeLessThan(500)
      expect(r.status).toBe(200)
      expect(r.text).toContain('stopped')
      expect(repo.getCollabRun(id)!.reason).toMatch(/Writing a short wrap-up/)
      expect(locks.size).toBe(0)
      vi.advanceTimersByTime(1600)
      expect(role(runs[runs.length - 1])).toBe('wrapup')
      expect(runs[runs.length - 1].params.prompt).toContain('STOPPED')
      finish('## Outcome\nNothing was written: the Maker never produced quiz/q.md.\n\n## Files\n- None\n\n## Decisions for you\n- None\n\n## Follow-ups\n- Retry')
      const s = repo.getCollabRun(id)!
      expect(s).toMatchObject({ status: 'stopped', reason: 'Stopped by you.', summary: 'Stopped with 0/2 tasks passed' })
      expect((await runCliCommand('collab', P({ do: 'status', run: id }))).text).toContain('Nothing was written')
      expect(locks.size).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('keeps every attempt across a reassignment, tells the wrap-up, and uses the Planner’s reviewer', async () => {
    const id = start()
    finish(plan([
      { title: 'Write the quiz', kind: 'work', provider: 'grok', reviewer: 'codex', scope: 'quiz/sub/q.md', acceptance: '5 questions', dependsOn: [] },
      { title: 'Final review', kind: 'review', reviewer: 'grok', scope: '', acceptance: 'meets the goal', dependsOn: [0] }
    ]))
    expect(repo.getCollabRun(id)!.tasks!.map((t) => t.meta.reviewer)).toEqual(['codex', 'grok'])
    orch.confirmPlan(sender, id)
    expect(existsSync(join(proj, 'quiz', 'sub'))).toBe(true)        // folders made before the Maker starts
    finish(json({ status: 'done', filesChanged: [], verify: '' }))     // Grok wrote nothing, twice
    finish(json({ status: 'done', filesChanged: [], verify: '' }))
    expect(role(runs[runs.length - 1])).toBe('repair')               // same failure twice → Planner
    finish(json({ summary: 'Grok never writes the file.', recommended: 0, options: [{ label: 'Give T1 to Claude', action: 'reassign', provider: 'claude-code', changesGoal: false }] }))
    const t1 = repo.getCollabRun(id)!.tasks![0]
    expect(t1.attempts).toBe(1)                                      // reset by the reassignment…
    expect(t1.meta.tries!.map((x) => [x.agent, x.result])).toEqual([['grok', 'failed'], ['grok', 'failed'], ['claude-code', undefined]])
    finish(handoff, { 'quiz/sub/q.md': '1. a\n2. b\n3. c\n4. d\n5. e\n' })
    const review1 = runs[runs.length - 1]
    expect(review1.params).toMatchObject({ providerId: 'codex' })     // the Planner's pick
    finish(PASS)
    expect(runs[runs.length - 1].params).toMatchObject({ providerId: 'grok' })
    finish(PASS)
    const wrap = runs[runs.length - 1]
    expect(role(wrap)).toBe('wrapup')
    expect(wrap.params.prompt).toMatch(/attempts, in order: Grok failed \(Deliverable missing.*\), Grok failed .*, Claude passed/)
    expect(wrap.params.prompt).toMatch(/plan changes: .*Give T1 to Claude \(the Planner\)/)
    finish('## Outcome\nDone.\n\n## Decisions for you\n- Pick a title\n\n## Follow-ups\n- None')
    expect(repo.getCollabRun(id)!.summary).toBe('Completed 2/2 tasks · T1 done by Claude after 2 failed tries · 1 decision for you in the wrap-up')
    const st = await runCliCommand('collab', P({ do: 'status', run: id, format: 'json' }))
    expect((st.json as { tasks: { attempts: number; reviewer: string }[] }).tasks[0]).toMatchObject({ attempts: 3, reviewer: 'Codex' })
    expect((await runCliCommand('collab', P({ do: 'status', run: id }))).text).toContain('tries: Grok failed, Grok failed, Claude passed')
  })

  it('a handover moves the review off the new Maker, so nobody reviews its own work', () => {
    const id = start()
    finish(plan([{ title: 'Facts', kind: 'work', provider: 'grok', scope: 'quiz/facts.md', acceptance: 'ok', dependsOn: [] }, TWO[1]]))
    orch.confirmPlan(sender, id)
    finish(json({ status: 'done', filesChanged: [], verify: '' }))
    finish(json({ status: 'done', filesChanged: [], verify: '' }))
    finish(json({ summary: 's', recommended: 0, options: [{ label: 'Give T1 to Claude', action: 'reassign', provider: 'claude-code', changesGoal: false }] }))
    const t = repo.getCollabRun(id)!.tasks![0]
    expect(t.provider).toBe('claude-code')
    expect(t.meta.reviewer).toBeDefined()
    expect(t.meta.reviewer).not.toBe('claude-code')
    expect(t.meta.reviewer).not.toBe('grok')                         // Grok just failed it twice
    expect(t.meta.history!.at(-1)).toMatch(/review moved to .* so Claude doesn't review its own work/)
    finish(handoff, { 'quiz/facts.md': 'facts' })
    expect(runs[runs.length - 1].params).toMatchObject({ providerId: t.meta.reviewer })
  })

  it('a Maker blocked at a permission prompt gets that as its finding and goes to the Planner, not a retry', () => {
    const id = start()
    finish(plan([{ title: 'Facts', kind: 'work', provider: 'grok', scope: 'quiz/facts.md', acceptance: 'ok', dependsOn: [] }, TWO[1]]))
    orch.confirmPlan(sender, id)
    finish('I will fetch the sources now.\n\n_Grok was blocked asking permission for `web_fetch`: a background run can\'t answer a permission prompt, so the turn ended (`cancelled`)._')
    const t = repo.getCollabRun(id)!.tasks![0]
    expect(t.lastVerdict!.findings[0]).toMatch(/^Grok was blocked asking permission for web_fetch: .*Retrying Grok unchanged will stop at the same prompt/)
    expect(t.meta.tries!.at(-1)).toMatchObject({ agent: 'grok', result: 'blocked' })
    const r = runs[runs.length - 1]
    expect(role(r)).toBe('repair')                                     // first failure: straight to the Planner
    expect(r.params.prompt).toContain('give the task to an agent that CAN in this run')
  })

  it('an agent error ends the try (no "in progress" on a failed task)', () => {
    const id = start()
    finish(plan([{ title: 'Facts', kind: 'work', provider: 'grok', scope: 'quiz/facts.md', acceptance: 'ok', dependsOn: [] }, TWO[1]]))
    orch.confirmPlan(sender, id)
    runs[runs.length - 1].params.onDone!(null, "Couldn't create session")
    const t = repo.getCollabRun(id)!.tasks![0]
    expect(t.status).toBe('failed')
    expect(t.meta.tries!.at(-1)).toMatchObject({ agent: 'grok', result: 'failed', why: "Grok errored: Couldn't create session" })
  })

  it('a Reviewer that cannot open the files is not a FAIL: the review moves to another agent (test 7)', () => {
    const id = start()
    finish(plan([{ title: 'Quiz', kind: 'work', reviewer: 'codex', scope: 'quiz/q.md', acceptance: '5 questions', dependsOn: [] }, TWO[1]]))
    orch.confirmPlan(sender, id)
    finish(handoff, { 'quiz/q.md': 'q' })
    const rev = runs[runs.length - 1]
    expect(rev.params).toMatchObject({ providerId: 'codex' })
    expect(rev.params.prompt).toContain('read-only commands — cat, ls, rg, head, sed -n — are allowed')
    expect(rev.params.prompt).toContain('"verdict": "BLOCKED"')
    const makersBefore = runs.filter((r) => role(r) === 'maker').length
    finish(json({ verdict: 'FAIL', findings: ['I could not read quiz.md or facts.md. No direct local-file reading tool is available, and the Reviewer instructions prohibit running commands.'] }))
    const next = runs[runs.length - 1]
    expect(role(next)).toBe('reviewer')                                      // re-review, not a Maker retry
    expect(next.params.providerId).not.toBe('codex')
    expect(runs.filter((r) => role(r) === 'maker').length).toBe(makersBefore)
    const t = repo.getCollabRun(id)!.tasks![0]
    expect(t.lastVerdict).toBeNull()
    expect(t.meta.history!.at(-1)).toMatch(/review moved to .*: Codex couldn't complete the review — /)
    finish(json({ verdict: 'BLOCKED', findings: ['Cannot open files either'] }))
    expect(role(runs[runs.length - 1])).toBe('reviewer')                     // a third agent, if one is on
  })

  it('tells a real defect from a review that could not be done', () => {
    expect(orch.reviewerCouldNotCheck(['I could not read quiz.md: no file reading tool is available'])).toBe(true)
    expect(orch.reviewerCouldNotCheck(['Question 3 has no answer in quiz.md'])).toBe(false)
    expect(orch.reviewerCouldNotCheck(['I could not read quiz.md', 'Question 3 is wrong'])).toBe(false)
    expect(orch.reviewerCouldNotCheck([])).toBe(false)
  })

  it('the unchanged-files check only follows a first attempt or a real Reviewer FAIL', () => {
    mkdirSync(join(proj, 'quiz')); writeFileSync(join(proj, 'quiz', 'q.md'), 'old\n')
    const id = start()
    finish(plan(TWO)); orch.confirmPlan(sender, id)
    finish(handoff)                                                           // attempt 1, unchanged → app FAIL
    expect(repo.getCollabRun(id)!.tasks![0].lastVerdict!.findings[0]).toMatch(/No changes were written/)
    finish(handoff)                                                           // attempt 2 after the app check: no second app FAIL
    expect(role(runs[runs.length - 1])).not.toBe('maker')
  })

  it('collab messages are tagged for the chat; list works without a project', async () => {
    const id = start()
    finish(plan(TWO))
    const m = listMessages(chat).find((x) => x.role === 'assistant')!
    expect(m.metadata?.collab).toEqual({ runId: id, role: 'planner' })
    const l = await runCliCommand('collab', P({ do: 'list' }))
    expect((l.json as { run: string }[]).map((x) => x.run)).toEqual([id])
    expect(existsSync(join(proj, '.workbench', 'collab', id, 'PLAN.md'))).toBe(true)
  })
})

describe('Read-only runs and run limits (D-127)', () => {
  const startRead = () => orch.startCollab(sender, { conversationId: chat, cwd: proj, providerId: 'claude-code', goal: 'Write a 5-question quiz', permissionMode: 'read' }).id

  it('tells the Planner what agents can do in THIS run, and Read-only Makers return their files for Troupe to save', () => {
    const id = startRead()
    expect(runs[0].params.prompt).toContain('This run is Read-only. No agent in it can change project files')
    expect(runs[0].params.prompt).toContain('reads files; cannot change them')
    finish(plan(TWO))
    orch.confirmPlan(sender, id)
    const maker = runs[1]
    expect(maker.params.prompt).toContain('This run is Read-only: you can open and read project files')
    expect(maker.params.prompt).toContain('=== FILE: quiz/q.md ===')
    // an existing file the task replaces is saved too, when the reply carries a FILE block
    mkdirSync(join(proj, 'quiz'), { recursive: true }); writeFileSync(join(proj, 'quiz/q.md'), 'old\n')
    finish('=== FILE: quiz/q.md ===\n1. a\n2. b\n=== END FILE ===\n' + handoff)
    expect(readFileSync(join(proj, 'quiz/q.md'), 'utf8')).toBe('1. a\n2. b\n')
    expect(role(runs[2])).toBe('reviewer')
  })

  it('a refusal no agent in the run could get past pauses with "Switch run to Auto" — not the Planner moving agents', () => {
    const id = startRead()
    finish(plan(TWO))
    orch.confirmPlan(sender, id)
    const before = runs.length
    finish(json({ status: 'blocked', filesChanged: [], verify: 'The run is read-only; it needs Auto mode to write quiz/q.md.' }))
    expect(runs.length).toBe(before)                        // no Planner repair run
    const run = repo.getCollabRun(id)!
    expect(run.status).toBe('needs_attention')
    expect(run.repair?.options[0]).toMatchObject({ action: 'mode', mode: 'auto', label: 'Switch run to Auto, retry' })
    expect(run.repair?.options.map((o) => o.action)).toEqual(['mode', 'skip'])
    orch.applyRepair(sender, id, 0)
    expect(repo.getCollabRun(id)!.permissionMode).toBe('auto')
    expect(role(runs[runs.length - 1])).toBe('maker')          // the task runs again, now in Auto
    expect(runs[runs.length - 1].params.prompt).not.toContain('This run is Read-only')
  })

  it('switches mode only before running or while paused, never to Full access', () => {
    const id = startRead()
    expect(() => orch.setCollabMode(id, 'auto')).toThrow(/before running|paused/)   // still planning
    finish(plan(TWO))
    expect(orch.setCollabMode(id, 'auto')!.permissionMode).toBe('auto')
    expect(() => orch.setCollabMode(id, 'full' as never)).toThrow(/Read-only and Auto/)
  })
})

describe('Reviewers get Troupe\'s record (D-128)', () => {
  it('names the Maker and the files that changed, and a moved review keeps its real reason', async () => {
    const id = start()
    writeFileSync(join(proj, 'notes.txt'), 'untouched')   // there before the Maker started: not in the record
    finish(plan(TWO))
    orch.confirmPlan(sender, id)
    finish(handoff, { 'quiz/q.md': '1. a\n2. b\n3. c\n4. d\n5. e\n' })
    const rev = runs[runs.length - 1]
    expect(role(rev)).toBe('reviewer')
    expect(rev.params.prompt).toContain('## What Troupe recorded for this attempt (facts — no need to verify them)')
    expect(rev.params.prompt).toMatch(/Made by Claude[^.]*\. While it worked, the project added `quiz\/q\.md` — nothing else changed/)
    expect(rev.params.prompt).toContain('Not having git history, not knowing who wrote a file')
    finish(json({ verdict: 'BLOCKED', findings: ['Cannot prove no other files changed: the folder is not a git repository.'] }))
    const t = repo.getCollabRun(id)!.tasks![0]
    expect(t.meta.history?.at(-1)).toMatch(/couldn't complete the review — Cannot prove no other files changed/)
    expect(t.meta.history?.at(-1)).not.toMatch(/couldn't open the files/)
  })

  it('troupe collab mode says what it did and shows the mode', async () => {
    const id = start()
    finish(plan(TWO))
    const r = await runCliCommand('collab', P({ do: 'mode', run: id, mode: 'read' }))
    expect(r.text).toMatch(/^Switched to Read-only/)
    expect(r.text).toContain('mode: Read-only')
    expect((await runCliCommand('collab', P({ do: 'mode', run: id, mode: 'read' }))).text).toMatch(/^Already Read-only/)
  })
})
