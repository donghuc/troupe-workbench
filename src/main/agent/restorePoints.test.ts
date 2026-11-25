import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

vi.mock('../util/logger', () => ({ logInfo: () => {}, logWarn: () => {}, logError: () => {} }))
const rp = await import('./restorePoints')
const hasGit = (() => { try { execFileSync('git', ['--version']); return true } catch { return false } })()

// D-151: snapshots live in the project's own .workbench/snapshots store; the project's .git is untouched.
describe.skipIf(!hasGit || !rp.findGit())('restore points', () => {
  let root: string
  beforeEach(() => { rp._resetForTests(); root = mkdtempSync(join(tmpdir(), 'troupe-rp-')) })

  it('records a turn, diffs it, restores it, and undoes the restore', async () => {
    writeFileSync(join(root, 'a.md'), 'one\ntwo\n'); mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs', 'b.md'), 'keep\n')
    mkdirSync(join(root, '.git')); writeFileSync(join(root, '.git', 'HEAD'), 'user repo\n')
    const before = await rp.takeSnapshot(root, 'before'); if (!('id' in before)) throw new Error('no snapshot')
    // the agent's turn
    writeFileSync(join(root, 'a.md'), 'one\nTWO\nthree\n'); writeFileSync(join(root, 'new.md'), 'hi\n'); rmSync(join(root, 'docs', 'b.md'))
    const after = await rp.takeSnapshot(root, 'after'); if (!('id' in after)) throw new Error('no snapshot')
    const files = await rp.diffSnapshots(root, before.id, after.id)
    expect(files).toEqual([{ path: 'a.md', status: 'M', add: 2, del: 1 }, { path: 'docs/b.md', status: 'D', add: 0, del: 1 }, { path: 'new.md', status: 'A', add: 1, del: 0 }])
    expect(await rp.fileDiff(root, before.id, after.id, 'a.md')).toContain('+TWO')
    // restore: a.md back, b.md back, new.md removed
    const safety = await rp.takeSnapshot(root, 'before-restore'); if (!('id' in safety)) throw new Error('no snapshot')
    const removed: string[] = []
    const failed = await rp.restorePaths(root, before.id, files.map((f) => f.path), async (abs) => { removed.push(abs); rmSync(abs) })
    expect(failed).toEqual([])
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('one\ntwo\n')
    expect(readFileSync(join(root, 'docs', 'b.md'), 'utf8')).toBe('keep\n')
    expect(existsSync(join(root, 'new.md'))).toBe(false)
    expect(removed).toEqual([join(root, 'new.md')])
    // undo: back to the agent's version
    await rp.restorePaths(root, safety.id, files.map((f) => f.path), async (abs) => rmSync(abs))
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('one\nTWO\nthree\n')
    expect(existsSync(join(root, 'docs', 'b.md'))).toBe(false)
    expect(readFileSync(join(root, 'new.md'), 'utf8')).toBe('hi\n')
    // the user's own .git and Troupe's store are never part of a snapshot
    expect(files.some((f) => f.path.startsWith('.git/') || f.path.startsWith('.workbench/'))).toBe(false)
    expect(readFileSync(join(root, '.git', 'HEAD'), 'utf8')).toBe('user repo\n')
  })

  it('prunes snapshots older than 30 days', async () => {
    writeFileSync(join(root, 'a.md'), 'x\n')
    const s = await rp.takeSnapshot(root, 'old'); expect('id' in s).toBe(true)
    expect(await rp.pruneSnapshots(root, Date.now() + 31 * 24 * 3600_000)).toBe(1)
  })
})
