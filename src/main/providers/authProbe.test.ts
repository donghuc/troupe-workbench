import { describe, it, expect } from 'vitest'
import { codexLoggedIn } from './authProbe'

describe('codex sign-in probe', () => {
  it('reads signed in', () => {
    expect(codexLoggedIn(false, 'Logged in using ChatGPT\n')).toBe(true)
    expect(codexLoggedIn(false, 'Logged in using an API key - sk-***\n')).toBe(true)
  })
  it('reads signed out — including the "Not logged in" text the old check mistook for signed in', () => {
    expect(codexLoggedIn(true, 'Not logged in\n')).toBe(false)
    expect(codexLoggedIn(false, 'Not logged in\n')).toBe(false)
    expect(codexLoggedIn(true, '')).toBe(false)
    expect(codexLoggedIn(false, 'error: something')).toBe(false)
  })
})
