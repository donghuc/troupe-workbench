import { describe, it, expect } from 'vitest'
import { parseDaily, parseEvery, planEdit, planDelete, reviewAction, describeChange, checkRunnable, RuleError } from './scheduleRules'
import type { Schedule } from './types'

const task = (o: Partial<Schedule> = {}): Schedule => ({
  id: 't1', projectId: 'p', title: 'Brief', prompt: 'old', provider: 'claude-code', model: null, permissionMode: 'auto',
  kind: 'daily', intervalMin: 60, atMin: 540, enabled: true, target: 'new', convId: null, nextRunAt: 0, lastRunAt: null, createdAt: 0,
  createdVia: 'app', botManaged: true, pending: null, ...o
})

describe('scheduled-task rules for bots (D-134)', () => {
  it('reads times', () => {
    expect(parseDaily('8:05')).toBe(485)
    expect(() => parseDaily('25:00')).toThrow(RuleError)
    expect(parseEvery('2h')).toBe(120)
    expect(parseEvery('45')).toBe(45)
    expect(() => parseEvery('10m')).toThrow(/15 minutes/)
  })
  it('edits: handed over only, never up, Full waits', () => {
    expect(() => planEdit(task({ botManaged: false }), { prompt: 'x' })).toThrow(/handed over/)
    expect(() => planEdit(task({ permissionMode: 'read' }), { permissionMode: 'auto' })).toThrow(/raise/)
    expect(planEdit(task(), { prompt: 'x' })).toEqual({ apply: { prompt: 'x' } })
    expect(planEdit(task({ permissionMode: 'full' }), { permissionMode: 'read' })).toEqual({ apply: { permissionMode: 'read' } })
    const p = planEdit(task({ permissionMode: 'full' }), { prompt: 'x', permissionMode: 'auto' }, 5)
    expect(p).toEqual({ pending: { kind: 'edit', at: 5, patch: { prompt: 'x', permissionMode: 'auto' }, before: { prompt: 'old', permissionMode: 'full' }, wasEnabled: true } })
    expect(describeChange((p as { pending: Parameters<typeof describeChange>[0] }).pending)).toEqual(['Prompt: “old” → “x”', 'Mode: Full access → Auto'])
  })
  it('deletes, runs and reviews', () => {
    expect(planDelete(task())).toEqual({ delete: true })
    expect(planDelete(task({ permissionMode: 'full', enabled: false }), 1)).toEqual({ pending: { kind: 'delete', at: 1, wasEnabled: false } })
    expect(() => checkRunnable(task({ pending: { kind: 'new', at: 0 } }), 'run')).toThrow(/waits for approval/)
    expect(reviewAction({ kind: 'new', at: 0 }, false)).toEqual({ op: 'delete' })
    expect(reviewAction({ kind: 'edit', at: 0, patch: { title: 'B' }, wasEnabled: false }, true)).toEqual({ op: 'update', patch: { title: 'B', enabled: false } })
    expect(reviewAction({ kind: 'delete', at: 0, wasEnabled: true }, false)).toEqual({ op: 'restore', enabled: true })
  })
})
