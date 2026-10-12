import { describe, it, expect } from 'vitest'
import { cleanErrorMessage, errorStack, formatErrorDetails } from './errors'

describe('cleanErrorMessage', () => {
  it('strips the Electron IPC wrapper', () => {
    const e = new Error("Error invoking remote method 'collab:start': Error: Conversation is busy")
    expect(cleanErrorMessage(e)).toBe('Conversation is busy')
  })
  it('strips a typed inner error name too', () => {
    expect(cleanErrorMessage("Error invoking remote method 'files:read': TypeError: bad path")).toBe('bad path')
  })
  it('keeps ordinary messages', () => {
    expect(cleanErrorMessage(new Error('disk full'))).toBe('disk full')
  })
  it('handles strings, message-shaped objects, and junk', () => {
    expect(cleanErrorMessage('plain')).toBe('plain')
    expect(cleanErrorMessage({ message: 'shaped' })).toBe('shaped')
    expect(cleanErrorMessage({ code: 1 })).toBe('{"code":1}')
    expect(cleanErrorMessage(undefined)).toBe('undefined')
    expect(cleanErrorMessage('')).toBe('Unknown error')
  })
})

describe('errorStack / formatErrorDetails', () => {
  it('caps long stacks', () => {
    const e = new Error('x'); e.stack = 'a'.repeat(50)
    expect(errorStack(e, 10)).toBe('a'.repeat(10) + '\n…(truncated)')
    expect(errorStack('nope')).toBeUndefined()
  })
  it('formats where, message, extra and stack', () => {
    const e = new Error('boom'); e.stack = 'Error: boom\n    at x'
    expect(formatErrorDetails('Sidebar', e, 'Component: <Sidebar>')).toBe('Where: Sidebar\nError: boom\nComponent: <Sidebar>\n\nError: boom\n    at x')
  })
})
