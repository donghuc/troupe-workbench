import { describe, expect, it } from 'vitest'
import { hasCollab, stripCollab } from './collabMention'

describe('@collab in the composer (D-129)', () => {
  it('spots the token anywhere, as a word', () => {
    expect(hasCollab('@collab build the quiz')).toBe(true)
    expect(hasCollab('build the quiz @Collab')).toBe(true)
    expect(hasCollab('mail me@collab.io')).toBe(false)
    expect(hasCollab('@collaborate on this')).toBe(false)
  })
  it('sends the goal without it', () => {
    expect(stripCollab('@collab build the quiz')).toBe('build the quiz')
    expect(stripCollab('build  @collab the quiz')).toBe('build the quiz')
    expect(stripCollab('line one\n@collab line two')).toBe('line one\nline two')
    expect(stripCollab('@collab')).toBe('')
  })
})
