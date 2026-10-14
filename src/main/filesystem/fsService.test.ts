import { describe, it, expect } from 'vitest'
import { resolve, sep } from 'path'
import { ensureInside, mimeForPath, looksBinary } from './fsService'

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

describe('looksBinary', () => {
  it('treats text (incl. UTF-8 and tabs/newlines) as text', () => {
    expect(looksBinary(Buffer.from('# Title\n\tTiếng Việt ✓\r\n'))).toBe(false)
    expect(looksBinary(Buffer.alloc(0))).toBe(false)
  })
  it('flags NUL bytes and control-heavy data (JPEG header)', () => {
    expect(looksBinary(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toBe(true)
    expect(looksBinary(Buffer.from([1, 2, 3, 4, 5, 6, 65, 66]))).toBe(true)
  })
})
