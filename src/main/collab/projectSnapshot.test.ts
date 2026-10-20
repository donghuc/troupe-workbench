import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { snapshot, diffSnapshots } from './projectSnapshot'

describe('project snapshot (D-128)', () => {
  it('lists what was added, changed and removed, skipping build and bookkeeping folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'snap-'))
    mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'node_modules', 'x'), { recursive: true }); mkdirSync(join(root, '.workbench'))
    writeFileSync(join(root, 'docs', 'a.md'), 'a'); writeFileSync(join(root, 'keep.txt'), 'k'); writeFileSync(join(root, 'gone.txt'), 'g')
    writeFileSync(join(root, 'node_modules', 'x', 'i.js'), '1'); writeFileSync(join(root, '.workbench', 's.md'), 's')
    const before = snapshot(root)!
    expect([...before.keys()].sort()).toEqual(['docs/a.md', 'gone.txt', 'keep.txt'])
    writeFileSync(join(root, 'docs', 'a.md'), 'changed'); utimesSync(join(root, 'docs', 'a.md'), new Date(), new Date(Date.now() + 5000))
    writeFileSync(join(root, 'docs', 'b.md'), 'new'); rmSync(join(root, 'gone.txt'))
    writeFileSync(join(root, 'node_modules', 'x', 'i.js'), '2')
    expect(diffSnapshots(before, snapshot(root)!)).toEqual({ added: ['docs/b.md'], changed: ['docs/a.md'], removed: ['gone.txt'] })
    expect(snapshot(root, 1)).toBeNull()
  })
})
