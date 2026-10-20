import { describe, expect, it } from 'vitest'
import { failSig, nextSameFails, parseRepair } from './collabRecovery'

describe('failSig / nextSameFails', () => {
  it('treats reworded repeats of the same failure as the same', () => {
    const a = failSig(['1. BLOCKING — Deliverable missing: `collab/x/judgements/x-opencode.md` does not exist. judgements/ contains only claude-code.md'])
    const b = failSig(['BLOCKING - Deliverable missing: `collab/x/judgements/x-opencode.md` does not exist (6th time). judgements/ contains only claude-code.md'])
    expect(nextSameFails(a, 1, b)).toBe(2)
    expect(nextSameFails(a, 2, failSig(['Table is missing the age column']))).toBe(1)
    expect(nextSameFails(undefined, undefined, a)).toBe(1)
  })
})

describe('parseRepair', () => {
  const isAgent = (id: string) => ['claude-code', 'codex'].includes(id)
  it('keeps valid options, drops unknown agents and empty rewrites, never auto-skips', () => {
    const r = parseRepair({
      summary: 'x-opencode cannot write files',
      recommended: 1,
      options: [
        { label: 'Give T4 to Ghost', action: 'reassign', provider: 'ghost' },
        { label: 'Give T4 to Codex', action: 'reassign', provider: 'codex', changesGoal: false, note: 'Write judgements/codex-2.md', userStep: 'Sign in to Codex' },
        { label: 'Use three judgements', action: 'skip', changesGoal: false, note: 'T5 uses three judgements' },
        { label: 'nothing', action: 'rewrite' },
        { label: 'bad', action: 'explode' }
      ]
    }, 't4', isAgent)!
    expect(r.options.map((o) => o.label)).toEqual(['Give T4 to Codex', 'Use three judgements'])
    expect(r.options[1].changesGoal).toBe(true)
    expect(r.options[0].userStep).toBe('Sign in to Codex')
    expect(r.recommended).toBe(1)
    expect(parseRepair({ options: [] }, 't4', isAgent)).toBeNull()
  })
})

describe('same failure, worded differently (real T1 log, D-111)', () => {
  const f1 = ['Source missing: README.md does not exist anywhere in the project (no README found at the root or in any subfolder). The task\'s dependency is not met; the task should be reported as BLOCKED, not done.', "notes/summary.md:1 contains only 'I can't help with that.' This is a refusal, not a prose summary of README.md.", 'Word count is 5, outside the required 90-110 range.']
  const f2 = ['README.md does not exist anywhere in the project (Glob **/README* finds nothing). The task is explicitly BLOCKED until README.md exists, so the Maker should have escalated the blocker instead of reporting done.', "notes/summary.md line 1 contains only the refusal 'I can't help with that.' (~5 words). It is not a summary, fails the 90-110 word count, has no claims traceable to README.md."]
  const f3 = ['notes/summary.md:1 — Acceptance criteria not met: the file contains only a 26-word BLOCKED placeholder, not a 90-110 word prose summary of README.md.', 'Project root — Blocker confirmed: README.md does not exist (glob **/*eadme* and **/*EADME* return no files), so no summary traceable to README.md can be written.']
  const other = ['Table is missing the age-in-days column for items 3 and 7; positivity scores have no reasons.']
  it('matches the repeats and not an unrelated failure', () => {
    const s1 = failSig(f1), s2 = failSig(f2), s3 = failSig(f3)
    expect(nextSameFails(s1, 1, s2)).toBe(2)
    expect(nextSameFails(s2, 2, s3)).toBe(3)
    expect(nextSameFails(s3, 3, failSig(other))).toBe(1)
  })
})

describe('parseRepair — rework and goal fixes (D-121)', () => {
  const isAgent = () => true
  const isWork = (seq: number) => seq === 0 || seq === 1
  it('reads a rework of a work task by its plan number; drops one naming a review or unknown task', () => {
    const r = parseRepair({ summary: 's', recommended: 0, options: [
      { label: 'Redo T2', action: 'rework', task: 2, note: 'add Q5' },
      { label: 'Redo T3', action: 'rework', task: 3 },
      { label: 'Redo T9', action: 'rework', task: 9 }
    ] }, 'review', isAgent, isWork)!
    expect(r.options).toHaveLength(1)
    expect(r.options[0]).toMatchObject({ action: 'rework', taskSeq: 1, note: 'add Q5' })
  })
  it('an option carrying a corrected goal always counts as a goal change', () => {
    const r = parseRepair({ summary: 's', options: [{ label: 'Ask for 5', action: 'retry', changesGoal: false, goal: 'Write 5 questions' }] }, 't1', isAgent)!
    expect(r.options[0]).toMatchObject({ changesGoal: true, goal: 'Write 5 questions' })
  })
})
