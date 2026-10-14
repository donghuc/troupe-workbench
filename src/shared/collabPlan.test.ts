import { describe, it, expect } from 'vitest'
import { rowsFromTasks, draftsFromRows, nextRunnable, tasksToRetry, defaultOutputDir, sanitizeOutputDir, retargetScope } from './collabPlan'
import { resolveTaskModel, presetsFor, allPresetsFor, modelForProvider, parseDisabledModels, serializeDisabledModels } from './models'
import type { CollabTask } from './types'

const task = (seq: number, patch: Partial<CollabTask> = {}): CollabTask => ({
  id: `t${seq}`, runId: 'r', seq, title: `T${seq}`, kind: 'work', provider: null, model: null,
  scope: '', acceptance: '', dependsOn: [], status: 'pending', attempts: 0,
  lastVerdict: null, handoff: null, makerRunId: null, reviewerRunId: null, meta: {}, ...patch
})

describe('resolveTaskModel', () => {
  it('never hands the run model to a task on another provider (seen 2026-09-23)', () => {
    expect(resolveTaskModel('claude-code', 'opus', 'codex', null)).toBe('')
    expect(resolveTaskModel('claude-code', 'opus', 'grok', undefined)).toBe('')
  })
  it('uses the run model for tasks on the run provider', () => {
    expect(resolveTaskModel('claude-code', 'opus', null, null)).toBe('opus')
    expect(resolveTaskModel('claude-code', 'opus', 'claude-code', null)).toBe('opus')
  })
  it('keeps a valid task model and drops one that does not fit the provider', () => {
    expect(resolveTaskModel('claude-code', 'opus', null, 'sonnet')).toBe('sonnet')
    expect(resolveTaskModel('claude-code', 'opus', 'codex', 'opus')).toBe('')
    expect(resolveTaskModel('claude-code', '', 'codex', 'gpt-x', { codex: [{ v: 'gpt-x', l: 'X' }] })).toBe('gpt-x')
  })
})

describe('plan editor rows', () => {
  it('keeps dependencies through reorder and delete', () => {
    const tasks = [task(0), task(1), task(2, { dependsOn: ['t0', 't1'] }), task(3, { kind: 'review', dependsOn: ['t2'] })]
    const rows = rowsFromTasks(tasks)
    // user deletes task 1 and moves the synthesis to the top
    const edited = [rows[2], rows[0], rows[3]]
    const drafts = draftsFromRows(edited)
    expect(drafts.map((d) => d.dependsOn)).toEqual([['1'], [], ['0']])
    expect(drafts[0]).not.toHaveProperty('key')
  })
  it('drops self and duplicate dependencies', () => {
    const drafts = draftsFromRows([{ key: 'a', title: 'A', dependsOn: ['a', 'b', 'b'] }, { key: 'b', title: 'B' }])
    expect(drafts[0].dependsOn).toEqual(['1'])
  })
})

describe('nextRunnable', () => {
  it('runs in order and skips tasks whose dependency failed', () => {
    const tasks = [task(0, { status: 'failed' }), task(1, { dependsOn: ['t0'] }), task(2)]
    expect(nextRunnable(tasks)?.id).toBe('t2')
  })
  it('holds a review task until every earlier task has passed', () => {
    const tasks = [task(0, { status: 'passed' }), task(1, { status: 'failed' }), task(2, { kind: 'review' })]
    expect(nextRunnable(tasks)).toBeNull()
    tasks[1].status = 'skipped'
    expect(nextRunnable(tasks)?.id).toBe('t2')
  })
  it('treats an unknown dependency as unmet', () => {
    expect(nextRunnable([task(0, { dependsOn: ['gone'] })])).toBeNull()
  })
  it('lists failed tasks for retry', () => {
    expect(tasksToRetry([task(0, { status: 'failed' }), task(1, { status: 'passed' })]).map((t) => t.id)).toEqual(['t0'])
  })
})

describe('deliverables folder', () => {
  const t = Date.UTC(2026, 8, 23)
  it('builds a readable default from the goal', () => {
    expect(defaultOutputDir('Before we continue, I want to do a research on competitors and similar apps first', t))
      .toBe('collab/2026-09-23-research-competitors-similar-apps')
    expect(defaultOutputDir('!!!', t)).toBe('collab/2026-09-23')
  })
  it('accepts normal relative folders and rejects hidden, absolute or escaping ones', () => {
    expect(sanitizeOutputDir('research/competitors/', 'fb')).toBe('research/competitors')
    expect(sanitizeOutputDir('./collab/x', 'fb')).toBe('collab/x')
    for (const bad of ['.workbench/collab/x', 'a/../b', '/Users/me/x', 'C:/x', '', 'a/b/c/d/e', 'a/.hidden', 42]) {
      expect(sanitizeOutputDir(bad, 'fb')).toBe('fb')
    }
  })
  it('moves run-folder deliverable paths to the output folder, but not PLAN/STATUS', () => {
    const run = '.workbench/collab/f0d7'
    expect(retargetScope(`${run}/research/01.md — Life360; reads ${run}/PLAN.md and ./${run}/research/02.md`, run, 'collab/kin'))
      .toBe(`collab/kin/research/01.md — Life360; reads ${run}/PLAN.md and collab/kin/research/02.md`)
    expect(retargetScope('src/app.ts', run, 'collab/kin')).toBe('src/app.ts')
  })
})

describe('turning models on/off (D-072)', () => {
  const off = parseDisabledModels('claude-code:haiku, claude-code:fable,codex:gpt-x,garbage')
  it('parses keys and ignores junk', () => {
    expect([...off].sort()).toEqual(['claude-code:fable', 'claude-code:haiku', 'codex:gpt-x'])
    expect(serializeDisabledModels(['b:1', 'a:2', 'a:2'])).toBe('a:2,b:1')
  })
  it('hides switched-off models but always keeps Default', () => {
    expect(presetsFor('claude-code', {}, off).map((m) => m.v)).toEqual(['', 'opus', 'sonnet'])
    expect(allPresetsFor('claude-code').map((m) => m.v)).toContain('fable')
    expect(presetsFor('codex', { codex: [{ v: 'gpt-x', l: 'X' }, { v: 'gpt-y', l: 'Y' }] }, off).map((m) => m.v)).toEqual(['', 'gpt-y'])
  })
  it('a switched-off model falls back to the default when a run starts', () => {
    expect(modelForProvider('claude-code', 'haiku', {}, off)).toBe('')
    expect(modelForProvider('claude-code', 'opus', {}, off)).toBe('opus')
    expect(resolveTaskModel('claude-code', 'fable', null, null, {}, off)).toBe('')
  })
})
