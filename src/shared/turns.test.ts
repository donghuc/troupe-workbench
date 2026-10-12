import { describe, it, expect } from 'vitest'
import { turnDelta, applyTurnDelta, EMPTY_TURN, type TurnState, type TurnLane } from './turns'

const lane = (text: string, over: Partial<TurnLane> = {}): TurnLane => ({ provider: 'claude-code', text, activity: { label: 'Responding…', startedAt: 1 }, done: false, ...over })
const st = (lanes: TurnLane[], over: Partial<TurnState> = {}): TurnState => ({ ...EMPTY_TURN('c'), busy: true, lanes, ...over })

describe('turnDelta', () => {
  it('describes appended text only', () => {
    const d = turnDelta(st([lane('Hel'), lane('A', { provider: 'codex' })]), st([lane('Hello'), lane('A', { provider: 'codex' })]))
    expect(d).toEqual({ conversationId: 'c', append: [{ i: 0, from: 3, text: 'lo' }] })
  })
  it('is empty when nothing changed', () => {
    expect(turnDelta(st([lane('x')]), st([lane('x')]))).toEqual({ conversationId: 'c', append: [] })
  })
  it('falls back to full state for any other change', () => {
    const base = st([lane('ab')])
    expect(turnDelta(undefined, base)).toBeNull()
    expect(turnDelta(base, st([lane('ab')], { busy: false }))).toBeNull()
    expect(turnDelta(base, st([lane('ab')], { rev: 1 }))).toBeNull()
    expect(turnDelta(base, st([lane('ab')], { error: 'x' }))).toBeNull()
    expect(turnDelta(base, st([lane('ab')], { phase: 'compare' }))).toBeNull()
    expect(turnDelta(base, st([lane('ab'), lane('')]))).toBeNull()
    expect(turnDelta(base, st([lane('ab', { done: true })]))).toBeNull()
    expect(turnDelta(base, st([lane('ab', { activity: { label: 'Running Bash…', startedAt: 1 } })]))).toBeNull()
    expect(turnDelta(base, st([lane('ab', { provider: 'codex' })]))).toBeNull()
    expect(turnDelta(base, st([lane('aX')]))).toBeNull()      // not an append
    expect(turnDelta(base, st([lane('a')]))).toBeNull()       // shrank
    expect(turnDelta(base, { ...st([lane('ab')]), conversationId: 'other' })).toBeNull()
  })
})

describe('applyTurnDelta', () => {
  it('round-trips with turnDelta over a long stream', () => {
    let sent = st([lane(''), lane('', { provider: 'codex' })])
    let mirror = sent
    const full = 'The quick brown fox jumps over the lazy dog. '.repeat(40)
    for (let k = 1; k <= full.length; k += 7) {
      const next = st([lane(full.slice(0, k)), lane(full.slice(0, Math.floor(k / 2)), { provider: 'codex' })])
      const d = turnDelta(sent, next)!
      mirror = applyTurnDelta(mirror, d)!
      sent = next
      expect(mirror.lanes.map((l) => l.text)).toEqual(next.lanes.map((l) => l.text))
    }
  })
  it('accepts overlap after a re-sync and ignores text it already has', () => {
    const cur = st([lane('Hello wor')])
    expect(applyTurnDelta(cur, { conversationId: 'c', append: [{ i: 0, from: 5, text: ' world' }] })!.lanes[0].text).toBe('Hello world')
    expect(applyTurnDelta(cur, { conversationId: 'c', append: [{ i: 0, from: 2, text: 'llo' }] })).toBe(cur)
  })
  it('asks for a full state when text is missing or the lane is unknown', () => {
    const cur = st([lane('Hi')])
    expect(applyTurnDelta(cur, { conversationId: 'c', append: [{ i: 0, from: 5, text: '!' }] })).toBeNull()
    expect(applyTurnDelta(cur, { conversationId: 'c', append: [{ i: 1, from: 0, text: '!' }] })).toBeNull()
    expect(applyTurnDelta(cur, { conversationId: 'x', append: [] })).toBeNull()
  })
  it('does not mutate the input', () => {
    const cur = st([lane('a')])
    applyTurnDelta(cur, { conversationId: 'c', append: [{ i: 0, from: 1, text: 'b' }] })
    expect(cur.lanes[0].text).toBe('a')
  })
})
