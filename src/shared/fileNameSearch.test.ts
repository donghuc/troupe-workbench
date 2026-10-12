import { describe, it, expect } from 'vitest'
import { scoreFileName, rankFileNames } from './fileNameSearch'

const files = [
  'ATLAS-DESIGN-MASTER.md',
  'archive/design-master-old.md',
  'collab/2026-09-23-competitor-research/05-benchmark-synthesis.md',
  'design-objectives.md',
  'docs/master/notes.txt',
  'emotional-design-criteria.md'
]

describe('file-name search', () => {
  it('matches words across - _ . and spaces, any order, case-insensitive', () => {
    expect(scoreFileName('ATLAS-DESIGN-MASTER.md', 'design master')).not.toBeNull()
    expect(scoreFileName('ATLAS-DESIGN-MASTER.md', 'master atlas')).not.toBeNull()
    expect(scoreFileName('ATLAS-DESIGN-MASTER.md', 'design strategy')).toBeNull()
  })
  it('can match folder names too, but ranks name matches higher', () => {
    const r = rankFileNames(files, 'master').map((m) => m.relPath)
    expect(r[r.length - 1]).toBe('docs/master/notes.txt')
    expect(r.slice(0, 2)).toContain('ATLAS-DESIGN-MASTER.md')
  })
  it('puts exact and prefix matches first, shallower before deeper', () => {
    expect(rankFileNames(files, 'design objectives')[0].relPath).toBe('design-objectives.md')
    // A name that starts with the query beats one that only contains it.
    expect(rankFileNames(files, 'design master').map((m) => m.relPath)).toEqual(['archive/design-master-old.md', 'ATLAS-DESIGN-MASTER.md'])
    expect(rankFileNames(files, 'atlas design')[0].relPath).toBe('ATLAS-DESIGN-MASTER.md')
    expect(rankFileNames(files, 'benchmark')[0].relPath).toContain('05-benchmark-synthesis.md')
  })
  it('ignores empty queries and caps results', () => {
    expect(rankFileNames(files, '  ')).toEqual([])
    expect(rankFileNames(files, 'md', 2)).toHaveLength(2)
  })
})
