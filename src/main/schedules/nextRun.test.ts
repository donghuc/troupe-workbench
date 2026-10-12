import { describe, it, expect } from 'vitest'
import { computeNext } from './nextRun'

// Local-time helper: minutes after midnight on the given local date.
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min, 0, 0).getTime()

describe('computeNext — interval', () => {
  it('adds N minutes to `from`', () => {
    expect(computeNext('interval', 30, 0, 1_000_000)).toBe(1_000_000 + 30 * 60_000)
  })
  it('never fires faster than once a minute (0 or negative interval → 1 min)', () => {
    expect(computeNext('interval', 0, 0, 0)).toBe(60_000)
    expect(computeNext('interval', -5, 0, 0)).toBe(60_000)
  })
})

describe('computeNext — daily', () => {
  it('lands later today when the time has not passed yet', () => {
    const from = at(2026, 9, 18, 8, 0)
    expect(computeNext('daily', 60, 9 * 60, from)).toBe(at(2026, 9, 18, 9, 0))
  })
  it('lands tomorrow when today\'s time has already passed', () => {
    const from = at(2026, 9, 18, 10, 30)
    expect(computeNext('daily', 60, 9 * 60, from)).toBe(at(2026, 9, 19, 9, 0))
  })
  it('lands tomorrow when `from` is exactly the scheduled minute (no double fire)', () => {
    const from = at(2026, 9, 18, 9, 0)
    expect(computeNext('daily', 60, 9 * 60, from)).toBe(at(2026, 9, 19, 9, 0))
  })
  it('handles minutes past the hour and month rollover', () => {
    const from = at(2026, 9, 30, 23, 59)
    expect(computeNext('daily', 60, 7 * 60 + 45, from)).toBe(at(2026, 10, 1, 7, 45))
  })
})
