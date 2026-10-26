import { describe, it, expect } from 'vitest'
import { shouldBackup } from './migrations'

// Audit #6 (2026-10-26): the pre-migration copy is made only when a migration will run.
describe('backup before migrating', () => {
  it('copies only when the stored schema is behind the app', () => {
    expect(shouldBackup(25, 25)).toBe(false)   // an ordinary launch: no copy
    expect(shouldBackup(24, 25)).toBe(true)    // an upgrade: pre-v24.bak first
    expect(shouldBackup(0, 25)).toBe(false)    // a new database: nothing to keep
  })
})
