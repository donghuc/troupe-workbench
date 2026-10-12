import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { isUnder, matchRoot, expectString, expectOptionalString } from './pathGuard'

const root = resolve('/Users/h/Projects/App')

describe('isUnder', () => {
  it('accepts the directory itself and anything below it', () => {
    expect(isUnder(root, root)).toBe(true)
    expect(isUnder(`${root}/src/a.ts`, root)).toBe(true)
  })
  it('rejects a sibling that shares the prefix (the /App-other trap)', () => {
    expect(isUnder(`${root}-other/x`, root)).toBe(false)
  })
  it('rejects parents and unrelated paths', () => {
    expect(isUnder(resolve('/Users/h/Projects'), root)).toBe(false)
    expect(isUnder('/etc/passwd', root)).toBe(false)
  })
  it('normalises ../ before comparing', () => {
    expect(isUnder(`${root}/src/../../Secrets`, root)).toBe(false)
    expect(isUnder(`${root}/src/../docs`, root)).toBe(true)
  })
  it('tolerates a trailing slash on the directory', () => {
    expect(isUnder(`${root}/x`, root + '/')).toBe(true)
  })
})

describe('matchRoot', () => {
  const allowed = [root, resolve('/tmp/other')]
  it('returns the matching allowed dir, resolved', () => {
    expect(matchRoot(`${root}/deep/file`, allowed)).toBe(root)
    expect(matchRoot('/tmp/other', allowed)).toBe(resolve('/tmp/other'))
  })
  it('returns null when under none, and ignores empty entries', () => {
    expect(matchRoot('/Users/h/Desktop/x', allowed)).toBeNull()
    expect(matchRoot('/anything', ['', undefined as unknown as string])).toBeNull()
  })
})

describe('argument shape', () => {
  it('expectString rejects non-strings and empty strings', () => {
    expect(() => expectString(42, 'root')).toThrow(/Invalid root/)
    expect(() => expectString('', 'root')).toThrow(/Invalid root/)
    expect(expectString('ok', 'root')).toBe('ok')
  })
  it('expectOptionalString passes null/undefined through', () => {
    expect(expectOptionalString(null, 'x')).toBeNull()
    expect(expectOptionalString(undefined, 'x')).toBeNull()
    expect(() => expectOptionalString(1, 'x')).toThrow()
  })
})
