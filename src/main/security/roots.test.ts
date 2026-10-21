import { describe, it, expect, vi } from 'vitest'

// Review #6: a folder becomes a project root only if the picker just returned it, or it is one already.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wb-user' } }))
vi.mock('../database/db', () => ({
  getDb: () => ({ prepare: (sql: string) => ({ all: () => (/projects/.test(sql) && !/project_folders/.test(sql) ? [{ p: '/Users/me/Work' }] : []), get: () => undefined }) })
}))
const { assertPickedFolder, rememberPickedFolder } = await import('./roots')

describe('folders from the window (security review #6)', () => {
  it('accepts a folder the picker returned or an existing project folder, nothing else', () => {
    expect(() => assertPickedFolder('/')).toThrow(/folder picker/)
    expect(() => assertPickedFolder('/Users/me')).toThrow(/folder picker/)
    expect(() => assertPickedFolder(42)).toThrow()
    expect(assertPickedFolder('/Users/me/Work')).toBe('/Users/me/Work')
    rememberPickedFolder('/Users/me/New')
    expect(assertPickedFolder('/Users/me/New/')).toBe('/Users/me/New/')
  })
})
