import { describe, it, expect } from 'vitest'
import { shortDate } from './dates'

describe('shortDate', () => {
  const now = new Date(2026, 9, 20)
  it('is "Oct 8" this year and adds the year otherwise', () => {
    expect(shortDate(new Date(2026, 9, 8, 15, 30), now)).toBe('Oct 8')
    expect(shortDate(new Date(2025, 11, 31), now)).toBe('Dec 31, 2025')
    expect(shortDate(new Date(2026, 9, 8).toISOString(), now)).toBe('Oct 8')
    expect(shortDate('not a date', now)).toBe('')
  })
})
