import { describe, it, expect } from 'vitest'
import { linkUrlTransform, normalizeRel } from './links'

const abs = '/Users/me/Projects/Atlas/ATLAS-DESIGN-MASTER.md'

describe('local file links (B-048)', () => {
  it('keeps file:// and computer:// hrefs that the default sanitizer blanks', () => {
    expect(linkUrlTransform(`file://${abs}`)).toBe(`file://${abs}`)
    expect(linkUrlTransform(`computer://${abs}`)).toBe(`computer://${abs}`)
  })
  it('still sanitizes dangerous schemes and leaves web links alone', () => {
    expect(linkUrlTransform('javascript:alert(1)')).toBe('')
    expect(linkUrlTransform('https://example.com/a')).toBe('https://example.com/a')
  })
  it('turns link targets into plain paths', () => {
    expect(normalizeRel(`file://${abs}`)).toBe(abs)
    expect(normalizeRel(`${abs}:12`)).toBe(abs)
    expect(normalizeRel('./docs/My%20Notes.md#intro')).toBe('docs/My Notes.md')
    expect(normalizeRel('<src/app.ts:12:5>')).toBe('src/app.ts')
  })
})
