import { describe, it, expect } from 'vitest'
import { parseNameStatus, parseNumstat, mergeChanges, totals, laterOverlap, parseUnifiedDiff, changesOf } from './changes'

describe('turn changes (D-151)', () => {
  it('reads git name-status and numstat output', () => {
    const names = parseNameStatus('M\0docs/a.md\0A\0img/new file.png\0D\0old.txt\0')
    const nums = parseNumstat('3\t1\tdocs/a.md\0-\t-\timg/new file.png\0' + '0\t4\told.txt\0')
    expect(mergeChanges(names, nums)).toEqual([
      { path: 'docs/a.md', status: 'M', add: 3, del: 1 },
      { path: 'img/new file.png', status: 'A', binary: true },
      { path: 'old.txt', status: 'D', add: 0, del: 4 }
    ])
    expect(totals(mergeChanges(names, nums))).toEqual({ add: 3, del: 5 })
  })

  it('finds later replies that changed the same files, ignoring restored ones', () => {
    const c = (files: string[], restored = false) => ({ changes: { before: 'a', after: 'b', files: files.map((path) => ({ path, status: 'M' })), ...(restored ? { restored: { at: 1, safety: 's' } } : {}) } })
    const metas = [c(['x.md', 'y.md']), null, c(['z.md']), c(['y.md'], true), c(['y.md', 'x.md'])]
    expect(laterOverlap(metas, 0)).toEqual([{ path: 'y.md', at: 4 }, { path: 'x.md', at: 4 }])
    expect(laterOverlap(metas, 1)).toEqual([])
    expect(changesOf({ changes: { before: 'a' } })).toBeNull()
  })

  it('turns a unified diff into numbered lines', () => {
    const d = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -12,3 +12,3 @@ ## Welcome\n ## Welcome\n-See setup.\n+See getting started.\n \n'
    expect(parseUnifiedDiff(d).lines).toEqual([
      { kind: 'hunk', text: '## Welcome' },
      { kind: 'ctx', text: '## Welcome', oldNo: 12, newNo: 12 },
      { kind: 'del', text: 'See setup.', oldNo: 13 },
      { kind: 'add', text: 'See getting started.', newNo: 13 },
      { kind: 'ctx', text: '', oldNo: 14, newNo: 14 }
    ])
    expect(parseUnifiedDiff('Binary files a/x.png and b/x.png differ\n').binary).toBe(true)
  })
})
