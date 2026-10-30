import { describe, it, expect } from 'vitest'
import { resumeSession, turnCost, RESUME_WINDOW_MS, type ResumeMark } from './resumeGuard'

const at = 1_000_000_000
const mark: ResumeMark = { sessionId: 's1', count: 2, cwd: '/p', model: 'opus', ctxKey: 'k', at }
const prev = (over: Partial<ResumeMark> = {}, meta: Record<string, unknown> = {}) => ({ role: 'assistant', provider: 'claude-code', metadata: { resume: { ...mark, ...over }, ...meta } })
const now = { providerId: 'claude-code', count: 3, cwd: '/p', model: 'opus', ctxKey: 'k', at: at + 60_000 }

describe('resumeSession (D-146)', () => {
  it('resumes when only the new message was added', () => {
    expect(resumeSession(prev(), now)).toBe('s1')
  })
  it('runs fresh when anything else changed', () => {
    expect(resumeSession(undefined, now)).toBeNull()
    expect(resumeSession({ role: 'user', provider: null, metadata: null }, now)).toBeNull()
    expect(resumeSession({ ...prev(), provider: 'codex' }, now)).toBeNull()          // another agent answered
    expect(resumeSession(prev(), { ...now, count: 5 })).toBeNull()                   // messages added
    expect(resumeSession(prev(), { ...now, count: 2 })).toBeNull()                   // a message deleted
    expect(resumeSession(prev({ cwd: '/q' }), now)).toBeNull()
    expect(resumeSession(prev({ model: 'sonnet' }), now)).toBeNull()
    expect(resumeSession(prev({ model: null }), now)).toBeNull()
    expect(resumeSession(prev({ ctxKey: 'other' }), now)).toBeNull()                 // instructions / pinned files changed
    expect(resumeSession(prev(), { ...now, at: at + RESUME_WINDOW_MS + 1 })).toBeNull()   // cache gone cold
    expect(resumeSession(prev({}, { partial: true }), now)).toBeNull()               // stopped or failed reply
    expect(resumeSession({ role: 'assistant', provider: 'claude-code', metadata: {} }, now)).toBeNull()   // older reply, no mark
  })
})

describe('turnCost (D-146)', () => {
  it('turns a session total into this reply\'s cost', () => {
    expect(turnCost(0.55, 0.5)).toBeCloseTo(0.05)
    expect(turnCost(0.5, undefined)).toBe(0.5)
    expect(turnCost(0.2, 0.5)).toBe(0.2)               // total went down: not a running total after all
    expect(turnCost(undefined, 0.5)).toBeUndefined()
  })
})
