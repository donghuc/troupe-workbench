import { describe, it, expect } from 'vitest'
import { blockKindOf, parseBlock, answerText, answerComplete, uiAnswerOf, scanBlocks, replyBlocksOn, REPLY_BLOCK_GUIDE, type ChoicesBlock } from './replyBlocks'

const choices = { id: 'trip', title: 'Trip check', groups: [{ label: 'Age range', options: ['18–29', '30–49'] }, { label: 'Places', options: ['Lake', 'Peak', 'Town'], multi: true }], submit: 'Check' }

describe('reply blocks (D-149)', () => {
  it('reads the kind from the code element class', () => {
    expect(blockKindOf('language-troupe-steps')).toBe('steps')
    expect(blockKindOf('hljs language-troupe-choices')).toBe('choices')
    expect(blockKindOf('language-json')).toBeNull()
    expect(blockKindOf(undefined)).toBeNull()
  })

  it('accepts valid blocks of each kind', () => {
    const s = parseBlock('steps', JSON.stringify({ title: 'Plan', steps: [{ title: 'Day 1', body: 'Rest' }, { title: 'Day 2' }] }))
    expect(s).toEqual({ ok: true, block: { kind: 'steps', title: 'Plan', steps: [{ title: 'Day 1', body: 'Rest' }, { title: 'Day 2' }] } })
    const c = parseBlock('choices', JSON.stringify(choices))
    expect(c.ok && c.block.kind === 'choices' && c.block.id).toBe('trip')
    const src = parseBlock('sources', JSON.stringify({ sources: [{ title: 'Guide', url: 'https://example.com/a' }, { title: 'Bad', url: 'javascript:alert(1)' }] }))
    expect(src).toEqual({ ok: true, block: { kind: 'sources', sources: [{ title: 'Guide', url: 'https://example.com/a' }] } })
  })

  it('refuses what it cannot draw, with a reason', () => {
    expect(parseBlock('steps', '{"steps": [')).toEqual({ ok: false, problem: 'not valid JSON' })
    expect(parseBlock('steps', JSON.stringify({ steps: [{ title: 'only one' }] })).ok).toBe(false)
    expect(parseBlock('table', '{}')).toEqual({ ok: false, problem: 'unknown kind "table"' })
    const noSubmit = parseBlock('choices', JSON.stringify({ ...choices, submit: '' }))
    expect(noSubmit.ok && noSubmit.block.kind === 'choices' && noSubmit.block.submit).toBe('Send answers')   // left out by agents: a default label
    expect(parseBlock('choices', JSON.stringify({ ...choices, groups: [{ label: 'A', options: ['x', 'x'] }] })).ok).toBe(false)
    expect(parseBlock('sources', JSON.stringify({ sources: [{ title: 'x', url: 'file:///etc' }] })).ok).toBe(false)
  })

  it('gives an unnamed choices block a stable id', () => {
    const { id: _id, ...noId } = choices
    const a = parseBlock('choices', JSON.stringify(noId)), b = parseBlock('choices', JSON.stringify(noId))
    expect(a.ok && b.ok && a.block.kind === 'choices' && b.block.kind === 'choices' && a.block.id === b.block.id).toBe(true)
  })

  it('turns answers into the user message and checks they are complete', () => {
    const r = parseBlock('choices', JSON.stringify(choices))
    const b = (r.ok ? r.block : null) as ChoicesBlock
    expect(answerComplete(b, [['30–49'], []])).toBe(false)
    expect(answerComplete(b, [['30–49', '18–29'], ['Lake']])).toBe(false)   // single-choice group
    expect(answerComplete(b, [['30–49'], ['Lake', 'Peak']])).toBe(true)
    expect(answerText(b, [['30–49'], ['Lake', 'Peak']])).toBe('Trip check\nAge range: 30–49\nPlaces: Lake, Peak')
  })

  it('reads a saved answer from message metadata', () => {
    expect(uiAnswerOf({ uiAnswer: { messageId: 'm1', blockId: 'trip', values: [['30–49'], ['Lake', 3]] } })).toEqual({ messageId: 'm1', blockId: 'trip', values: [['30–49'], ['Lake']] })
    expect(uiAnswerOf({ uiAnswer: { blockId: 'trip' } })).toBeNull()
    expect(uiAnswerOf(null)).toBeNull()
  })

  it('finds the blocks in a finished reply for the log', () => {
    const text = 'Here is the plan.\n\n```troupe-steps\n{"steps":[{"title":"a"},{"title":"b"}]}\n```\n\nAnd:\n\n```troupe-choices\n{"groups":[]}\n```\n\n```json\n{}\n```'
    expect(scanBlocks(text)).toEqual([{ kind: 'steps', ok: true }, { kind: 'choices', ok: false, problem: 'needs 1–6 groups' }])
  })

  it('is on unless switched off, and its guide example passes its own rules', () => {
    expect(replyBlocksOn(null)).toBe(true)
    expect(replyBlocksOn('1')).toBe(true)
    expect(replyBlocksOn('0')).toBe(false)
    expect(scanBlocks(REPLY_BLOCK_GUIDE)).toEqual([{ kind: 'steps', ok: true }, { kind: 'choices', ok: true }, { kind: 'sources', ok: true }])
  })
})
