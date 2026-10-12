import { describe, it, expect } from 'vitest'
import { appendCapped, staleTempDirs, shouldRotate } from './limits'

describe('appendCapped', () => {
  it('keeps short output as is', () => {
    expect(appendCapped('ab', 'cd', 10)).toBe('abcd')
  })
  it('keeps only the tail of long output, marked as truncated', () => {
    expect(appendCapped('abcdef', 'ghij', 4)).toBe('…(earlier output truncated)\nghij')
  })
})

describe('staleTempDirs', () => {
  const now = 10 * 86_400_000
  it('picks only our old temp folders', () => {
    const e = [
      { name: 'workbench-ctx-a1', mtimeMs: now - 2 * 86_400_000, isDir: true },
      { name: 'wb-pdf-b2', mtimeMs: now - 3 * 86_400_000, isDir: true },
      { name: 'workbench-ctx-new', mtimeMs: now - 1000, isDir: true },   // in use
      { name: 'someone-else', mtimeMs: 0, isDir: true },
      { name: 'wb-pdf-file', mtimeMs: 0, isDir: false }
    ]
    expect(staleTempDirs(e, now)).toEqual(['workbench-ctx-a1', 'wb-pdf-b2'])
  })
})

describe('shouldRotate', () => {
  it('rotates at the limit', () => {
    expect(shouldRotate(10, 10)).toBe(true)
    expect(shouldRotate(9, 10)).toBe(false)
  })
})
