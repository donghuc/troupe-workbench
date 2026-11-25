import { describe, it, expect } from 'vitest'
import { parseApprovals, recordApproval } from './approvals'

describe('approval records (D-151)', () => {
  it('keeps the newest per task and ignores junk', () => {
    let raw = recordApproval(null, 't1', 'new', 10)
    raw = recordApproval(raw, 't2', 'edit', 20)
    raw = recordApproval(raw, 't1', 'edit', 30)
    expect(parseApprovals(raw)).toEqual({ t1: { at: 30, kind: 'edit' }, t2: { at: 20, kind: 'edit' } })
    expect(parseApprovals('{"x":{"at":"no"}}')).toEqual({})
    expect(parseApprovals('nope')).toEqual({})
  })
})
