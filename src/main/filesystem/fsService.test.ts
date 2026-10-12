import { describe, it, expect } from 'vitest'
import { resolve, sep } from 'path'
import { ensureInside, mimeForPath } from './fsService'

const root = resolve('/tmp/wb-root')

describe('ensureInside', () => {
  it('returns the absolute path for a plain relative target', () => {
    expect(ensureInside(root, 'notes/a.md')).toBe(resolve(root, 'notes/a.md'))
  })
  it('accepts the root itself (empty relative path)', () => {
    expect(ensureInside(root, '')).toBe(root)
  })
  it('rejects "../" escapes', () => {
    expect(() => ensureInside(root, '../etc/passwd')).toThrow(/escapes/)
    expect(() => ensureInside(root, 'a/../../b')).toThrow(/escapes/)
  })
  it('rejects absolute targets outside the root', () => {
    expect(() => ensureInside(root, '/etc/passwd')).toThrow(/escapes/)
  })
  it('rejects a sibling folder that merely shares the root prefix', () => {
    // /tmp/wb-root-other must not count as inside /tmp/wb-root
    expect(() => ensureInside(root, `${root}-other${sep}x`)).toThrow(/escapes/)
  })
  it('accepts an absolute target that is inside the root', () => {
    expect(ensureInside(root, resolve(root, 'deep/file.txt'))).toBe(resolve(root, 'deep/file.txt'))
  })
})

describe('mimeForPath', () => {
  it('maps known extensions case-insensitively', () => {
    expect(mimeForPath('a/b/Photo.JPG')).toBe('image/jpeg')
    expect(mimeForPath('doc.pdf')).toBe('application/pdf')
  })
  it('falls back to octet-stream', () => {
    expect(mimeForPath('archive.tar.zst')).toBe('application/octet-stream')
    expect(mimeForPath('noext')).toBe('application/octet-stream')
  })
})
