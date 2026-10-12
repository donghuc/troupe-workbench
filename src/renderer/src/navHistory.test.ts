import { describe, it, expect } from 'vitest'
import { recordLoc, stepLoc, NAV_MAX, type NavStack } from './navHistory'

const fresh = (k = 'a'): NavStack => ({ stack: [k], i: 0, target: null })

describe('window history (D-086, extracted D-098)', () => {
  it('records new views and ignores repeats', () => {
    const h = fresh()
    expect(recordLoc(h, 'a')).toBe(false)
    expect(recordLoc(h, 'b')).toBe(true); expect(recordLoc(h, 'c')).toBe(true)
    expect(h).toMatchObject({ stack: ['a', 'b', 'c'], i: 2 })
  })
  it('back/forward walk the stack, and the intermediate states on the way are not recorded', () => {
    const h = fresh(); recordLoc(h, 'b'); recordLoc(h, 'c')
    expect(stepLoc(h, -1)).toBe('b')
    expect(recordLoc(h, 'c-ish intermediate')).toBe(false)
    expect(recordLoc(h, 'b')).toBe(false)          // arrived: target cleared, already there
    expect(h.target).toBeNull()
    expect(stepLoc(h, 1)).toBe('c'); recordLoc(h, 'c')
    expect(stepLoc(h, 1)).toBeNull()
    expect(stepLoc(h, -1)).toBe('b'); recordLoc(h, 'b')
    expect(stepLoc(h, -1)).toBe('a'); recordLoc(h, 'a')
    expect(stepLoc(h, -1)).toBeNull()
  })
  it('a new view after going back drops the forward steps', () => {
    const h = fresh(); recordLoc(h, 'b'); recordLoc(h, 'c')
    stepLoc(h, -1); recordLoc(h, 'b')
    recordLoc(h, 'x')
    expect(h).toMatchObject({ stack: ['a', 'b', 'x'], i: 2 })
  })
  it('keeps at most NAV_MAX steps', () => {
    const h = fresh()
    for (let k = 0; k < NAV_MAX + 15; k++) recordLoc(h, `v${k}`)
    expect(h.stack).toHaveLength(NAV_MAX); expect(h.i).toBe(NAV_MAX - 1)
  })
})
