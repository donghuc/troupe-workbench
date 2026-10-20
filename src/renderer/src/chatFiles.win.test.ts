// Windows paths in replies (D-120), run on any OS by pretending to be win32.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const real = process.platform
beforeAll(() => { Object.defineProperty(process, 'platform', { value: 'win32' }); vi.resetModules() })
afterAll(() => { Object.defineProperty(process, 'platform', { value: real }); vi.resetModules() })

describe('reply paths on Windows', () => {
  it('toRelPath strips the project folder in any case and either separator', async () => {
    const { toRelPath } = await import('./chatFiles')
    expect(toRelPath('C:\\Users\\h\\proj', 'C:\\Users\\h\\proj\\docs\\a.md')).toBe('docs/a.md')
    expect(toRelPath('C:\\Users\\h\\proj', 'c:/users/h/proj/docs/a.md')).toBe('docs/a.md')
    expect(toRelPath('C:\\Users\\h\\proj', '.\\docs\\a.md')).toBe('docs/a.md')
    expect(toRelPath('C:\\Users\\h\\proj', 'D:\\other\\a.md')).toBe('D:\\other\\a.md')
  })
  it('links with backslashes or file:///C:/ normalise', async () => {
    const { normalizeRel } = await import('./links')
    expect(normalizeRel('docs\\a.md')).toBe('docs/a.md')
    expect(normalizeRel('file:///C:/Users/h/a.md')).toBe('C:/Users/h/a.md')
  })
})
