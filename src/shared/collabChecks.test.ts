import { describe, expect, it } from 'vitest'
import { planBudget, planIssues, parseWrapUp, formatDuration } from './collabChecks'

const work = (title: string, scope: string, dependsOn: string[] = [], id?: string) => ({ id, title, kind: 'work' as const, scope, dependsOn })
const review = { title: 'Final review', kind: 'review' as const, scope: '', dependsOn: [] }

describe('planBudget (D-121)', () => {
  it('never goes below the old flat 24, and grows with the plan', () => {
    expect(planBudget([work('a', 'x'), review], 2)).toBe(24)
    expect(planBudget(Array.from({ length: 6 }, () => ({ kind: 'work' as const })).concat([{ kind: 'review' }]), 2)).toBe(1 + 6 * 6 + 2 + 2 + 1)
  })
})

describe('planIssues (D-121)', () => {
  it('flags a root-level output, a shared output, a missing output, a missing dependency and no review', () => {
    const issues = planIssues([
      work('Quiz', 'quiz.md', [], 'a'),
      work('Answers', 'out/answers.md', [], 'b'),
      work('Again', 'out/answers.md', [], 'c'),
      work('Notes', 'just think about it', [], 'd'),
      work('Uses answers', 'out/final.md (read-only: out/answers.md)', [], 'e')
    ], 'out')
    expect(issues.join('\n')).toMatch(/Task 1 .*`quiz\.md` outside the deliverables folder `out\/` — in the project root/)
    expect(issues.join('\n')).toMatch(/Tasks 2 and 3 both write `out\/answers\.md`/)
    expect(issues.join('\n')).toMatch(/Task 4 .*doesn't name a file/)
    expect(issues.join('\n')).toMatch(/Task 5 reads `out\/answers\.md` from task 2 but doesn't wait for it/)
    expect(issues.join('\n')).toMatch(/no final review/)
  })
  it('is quiet for a clean plan, and for editing an existing file outside the folder', () => {
    expect(planIssues([work('Edit readme', 'README.md'), work('B', 'out/b.md (read-only: README.md)', ['0']), review], 'out', (p) => p === 'README.md')).toEqual([])
  })
})

describe('parseWrapUp (D-121)', () => {
  it('reads the outcome paragraph and the bullets, ignoring "None"', () => {
    const w = parseWrapUp('## Outcome\nA quiz with 5 questions.\nAll reviewed.\n\nMore.\n\n## Files\n- `q.md`\n\n## Decisions for you\n- Pick a title\n\n## Follow-ups\n- None')
    expect(w).toEqual({ outcome: 'A quiz with 5 questions. All reviewed.', decisions: ['Pick a title'], followUps: [] })
    expect(parseWrapUp('no headings').outcome).toBe('')
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(52_400)).toBe('52 s')
    expect(formatDuration(245_000)).toBe('4 min 05 s')
    expect(formatDuration(3_900_000)).toBe('1 h 05 min')
  })
})
