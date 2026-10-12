import { describe, it, expect } from 'vitest'
import { parseDecisions, formatOutcome, appendOutcome, nextOutcomeId, decisionsContext, parseOutcomeDraft, buildOutcomePrompt, type Outcome } from './decisions'

const a: Outcome = { id: 'D-001', kind: 'decision', date: '2026-09-20', title: 'Cut the goals survey first', why: 'Pure deletion, lower risk.', considered: 'Move bank linking later (Claude, Grok).', open: 'Test link-later on 7-day retention.', source: 'Which sign-up step to cut?' }
const b: Outcome = { id: 'D-002', kind: 'insight', date: '2026-09-21', title: 'Users distrust bank linking in the first minute', why: '5 of 8 hesitated.' }

describe('decisions log (D-081)', () => {
  it('round-trips entries through the file format, newest first', () => {
    let md = appendOutcome('', a, 'Pebble onboarding')
    md = appendOutcome(md, b, 'Pebble onboarding')
    expect(md.startsWith('# Decisions · Pebble onboarding')).toBe(true)
    const list = parseDecisions(md)
    expect(list.map((o) => o.id)).toEqual(['D-002', 'D-001'])
    expect(list[1]).toEqual(a)
    expect(list[0].kind).toBe('insight')
    expect(nextOutcomeId(list)).toBe('D-003')
    expect(nextOutcomeId([])).toBe('D-001')
  })
  it('tolerates hand edits and multi-line fields', () => {
    const md = '# Decisions\n\n## D-007 · Open question · 2026-09-22 · Which tier?\n**Why:** line one\nline two\n\nsome stray prose\n\n## not an entry\n'
    const [o] = parseDecisions(md)
    expect(o.id).toBe('D-007'); expect(o.kind).toBe('question'); expect(o.why).toBe('line one\nline two')
    expect(formatOutcome(o)).toContain('## D-007 · Open question · 2026-09-22 · Which tier?')
  })
  it('builds the agent context: capped index + latest few in full', () => {
    const many: Outcome[] = Array.from({ length: 60 }, (_, i) => ({ id: `D-${String(60 - i).padStart(3, '0')}`, kind: 'decision', date: '2026-09-01', title: `t${60 - i}` }))
    const ctx = decisionsContext(many)
    expect(ctx).toContain('- D-060 · 2026-09-01 · Decision · t60')
    expect(ctx).toContain('…and 10 earlier')
    expect(ctx).toContain('## Latest 3 in full')
    expect((ctx.match(/^## D-/gm) ?? []).length).toBe(3)
    expect(decisionsContext([])).toBe('')
  })
  it('parses a draft out of a fenced reply and builds the prompt', () => {
    const d = parseOutcomeDraft('Here you go:\n```json\n{"kind":"insight","title":"X","why":"Y","considered":"","open":"","conflicts":"Contradicts D-001: …"}\n```')
    expect(d).toEqual({ kind: 'insight', title: 'X', why: 'Y', considered: undefined, open: undefined, conflicts: 'Contradicts D-001: …' })
    expect(parseOutcomeDraft('no json')).toBeNull()
    const p = buildOutcomePrompt({ transcript: 'User: hi', memory: '', existing: [a], chatTitle: 'Chat' })
    expect(p).toContain('- D-001 · 2026-09-20 · Decision · Cut the goals survey first')
    expect(p).toContain('(chat: "Chat")')
  })
})
