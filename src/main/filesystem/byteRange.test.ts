import { describe, it, expect } from 'vitest'
import { parseRange, isRangeMedia } from './byteRange'

describe('parseRange', () => {
  it('no header or a malformed one → whole file', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
    expect(parseRange('bytes=-', 100)).toBeNull()
  })
  it('open-ended and bounded ranges', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
  })
  it('suffix ranges', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })
  it('first range of a multi-range request', () => {
    expect(parseRange('bytes=0-9, 20-29', 100)).toEqual({ start: 0, end: 9 })
  })
  it('unsatisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=50-10', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
  })
})

describe('isRangeMedia', () => {
  it('video and audio only', () => {
    expect(isRangeMedia('video/mp4')).toBe(true)
    expect(isRangeMedia('audio/mpeg')).toBe(true)
    expect(isRangeMedia('application/pdf')).toBe(false)
    expect(isRangeMedia('image/png')).toBe(false)
  })
})
