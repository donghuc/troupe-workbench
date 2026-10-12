import { describe, it, expect } from 'vitest'
import { checkQuestions, parseGrades } from './contextCheck'

describe('check context (D-082)', () => {
  const qs = checkQuestions([
    { id: 'D-002', kind: 'decision', date: '2026-09-25', title: 'Cut the goals survey first', why: 'lower risk' },
    { id: 'D-001', kind: 'question', date: '2026-09-24', title: 'Which pricing tier to lead with' }
  ])
  it('turns log entries into questions with expected answers', () => {
    expect(qs[0].question).toContain('decide about: Cut the goals survey first')
    expect(qs[0].expected).toBe('Cut the goals survey first — Why: lower risk')
    expect(qs[1].question).toContain('open question')
  })
  it('joins grades with the fresh chat\'s answers, tolerating junk', () => {
    const r = parseGrades('Sure: [{"n":1,"ok":true,"note":""},{"n":2,"ok":false,"note":"said unknown"}]', qs, '1. We cut the survey because it was lower risk.\n2. unknown')
    expect(r.map((x) => x.ok)).toEqual([true, false])
    expect(r[0].answer).toBe('We cut the survey because it was lower risk.')
    expect(r[1].note).toBe('said unknown')
    expect(parseGrades('nope', qs, '').every((x) => !x.ok)).toBe(true)
  })
})
