import { describe, it, expect } from 'vitest'
import { afterTurn, startsNow, parseSavedQueues, queuedText, EMPTY_QUEUE, type QueueState } from './turnQueue'

const item = (id: string, conv = 'c1') => ({ id, text: id, input: { conversationId: conv, text: id, defaultProvider: 'claude-code' as const }, queuedAt: 1 })
const q = (items: string[], paused: QueueState['paused'] = null): QueueState => ({ conversationId: 'c1', items: items.map((i) => item(i)), paused })

describe('message queue rules (D-138)', () => {
  it('starts a send at once only when the chat is free and nothing is waiting to run', () => {
    expect(startsNow(EMPTY_QUEUE('c1'), false)).toBe(true)
    expect(startsNow(EMPTY_QUEUE('c1'), true)).toBe(false)
    expect(startsNow(q(['a']), false)).toBe(false)          // waiting messages go first
    expect(startsNow(q(['a'], 'stopped'), false)).toBe(true) // a paused queue doesn't block a new send
  })
  it('runs the next message after a turn that finished', () => {
    expect(afterTurn(q(['a', 'b']), 'done')).toMatchObject({ runNext: true })
  })
  it('pauses after Stop or a failure', () => {
    expect(afterTurn(q(['a']), 'stopped')).toMatchObject({ runNext: false, queue: { paused: 'stopped' } })
    expect(afterTurn(q(['a']), 'error')).toMatchObject({ runNext: false, queue: { paused: 'error' } })
  })
  it('stays paused through a turn sent around the paused queue', () => {
    expect(afterTurn(q(['a'], 'stopped'), 'done')).toMatchObject({ runNext: false, queue: { paused: 'stopped' } })
  })
  it('shows the typed words, not folded-in selections', () => {
    expect(queuedText({ conversationId: 'c1', text: '> quoted\n\nfix this', defaultProvider: 'codex', messageMetadata: { displayText: 'fix this' } })).toBe('fix this')
  })
  it('restores saved queues paused, dropping deleted chats and bad entries', () => {
    const raw = JSON.stringify([q(['a']), { ...q(['b']), conversationId: 'gone', items: [item('b', 'gone')] }, { conversationId: 'c2', items: [{ id: 'x' }] }])
    const out = parseSavedQueues(raw, (id) => id !== 'gone')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ conversationId: 'c1', paused: 'restart', items: [{ id: 'a' }] })
    expect(parseSavedQueues('nope', () => true)).toEqual([])
  })
})
