import { describe, it, expect } from 'vitest'
import { parsePinned } from './pinnedProjects'

describe('pinned projects setting', () => {
  it('reads a list of ids, ignoring junk and repeats', () => {
    expect(parsePinned('["a","b","a",3]')).toEqual(['a', 'b'])
    expect(parsePinned(null)).toEqual([])
    expect(parsePinned('{oops')).toEqual([])
    expect(parsePinned('{"a":1}')).toEqual([])
  })
})
