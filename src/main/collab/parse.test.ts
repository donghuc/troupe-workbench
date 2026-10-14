import { describe, it, expect } from 'vitest'
import { extractJson, findingToText } from './parse'

describe('extractJson', () => {
  it('reads a fenced ```json block, ignoring prose around it', () => {
    const t = 'Done.\n```json\n{ "verdict": "PASS", "findings": [] }\n```\n'
    expect(extractJson(t)).toEqual({ verdict: 'PASS', findings: [] })
  })
  it('prefers the fenced block over an earlier bare object', () => {
    const t = 'see {"a":1}\n```json\n{"b":2}\n```'
    expect(extractJson(t)).toEqual({ b: 2 })
  })
  it('falls back to the first {...} span when there is no fence', () => {
    expect(extractJson('result: {"status":"done","filesChanged":["a.ts"]} thanks')).toEqual({ status: 'done', filesChanged: ['a.ts'] })
  })
  it('returns null for no JSON or invalid JSON', () => {
    expect(extractJson('nothing here')).toBeNull()
    expect(extractJson('```json\n{ not json }\n```')).toBeNull()
  })
  it('is case-insensitive on the fence tag', () => {
    expect(extractJson('```JSON\n{"x":1}\n```')).toEqual({ x: 1 })
  })
})

describe('findingToText', () => {
  it('passes strings through', () => {
    expect(findingToText('missing test')).toBe('missing test')
  })
  it('flattens a finding object with severity, text and location', () => {
    expect(findingToText({ severity: 'high', finding: 'null deref', file: 'a.ts', line: 12 })).toBe('[high] null deref (a.ts:12)')
  })
  it('accepts the alternative field names reviewers use', () => {
    expect(findingToText({ issue: 'x', path: 'b.ts' })).toBe('x (b.ts)')
    expect(findingToText({ message: 'y' })).toBe('y')
  })
  it('never yields "[object Object]"', () => {
    expect(findingToText({ weird: true })).toBe('{"weird":true}')
    expect(findingToText(42)).toBe('42')
  })
})

describe('findingToText numbering', () => {
  it('drops the model\'s own "1." so the app\'s numbering isn\'t doubled', () => {
    expect(findingToText('1. README.md does not exist')).toBe('README.md does not exist')
    expect(findingToText({ finding: '2) word count is 5' })).toBe('word count is 5')
    expect(findingToText('2026 plan is fine')).toBe('2026 plan is fine')
  })
})
