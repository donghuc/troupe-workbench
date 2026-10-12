import { describe, it, expect } from 'vitest'
import { contentHash, isUneditedOldBuiltin } from './builtinVersions'

describe('built-in skill upgrade', () => {
  it('ignores line-ending and outer whitespace differences in the fingerprint', () => {
    expect(contentHash('a\r\nb\n')).toBe(contentHash('a\nb'))
  })
  it('upgrades only exact earlier versions, never edited or current copies', () => {
    expect(isUneditedOldBuiltin('user edited text', 'new canonical')).toBe(false)
    expect(isUneditedOldBuiltin('new canonical', 'new canonical')).toBe(false)
  })
})
