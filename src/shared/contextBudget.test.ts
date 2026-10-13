import { describe, it, expect } from 'vitest'
import { renderPinnedFile, firstHeading, memoryWarning, PINNED_INLINE_MAX, MEMORY_WARN_CHARS } from './contextBudget'

describe('contextBudget', () => {
  it('inlines small pinned files', () => {
    const r = renderPinnedFile('docs/a.md', '# A\nbody')
    expect(r.inlined).toBe(true)
    expect(r.text).toBe('## docs/a.md\n\n# A\nbody')
  })
  it('sends large pinned files as a reference with their first heading', () => {
    const big = '\n# Big spec\n' + 'x'.repeat(PINNED_INLINE_MAX + 1)
    const r = renderPinnedFile('spec.md', big)
    expect(r.inlined).toBe(false)
    expect(r.text).toContain('## spec.md (reference only')
    expect(r.text).toContain('It starts with: Big spec')
    expect(r.text.length).toBeLessThan(400)
  })
  it('firstHeading falls back to the first line', () => {
    expect(firstHeading('\n  plain start\n# later')).toBe('later')
    expect(firstHeading('plain only')).toBe('plain only')
    expect(firstHeading('')).toBe('')
  })
  it('warns only when memory is over the limit', () => {
    expect(memoryWarning('Project memory', MEMORY_WARN_CHARS)).toBeUndefined()
    expect(memoryWarning('Project memory', MEMORY_WARN_CHARS + 1)).toMatch(/Project memory is 4 KB/)
  })
})

describe('freshness (D-082)', () => {
  it('stamps lines once and flags old dated lines only', async () => {
    const { stampLine, staleMemoryNote } = await import('./contextBudget')
    const d = new Date(2026, 8, 25)
    expect(stampLine('Say pot, not envelope', d)).toBe('Say pot, not envelope (2026-09-25)')
    expect(stampLine('x (2026-01-01)', d)).toBe('x (2026-01-01)')
    expect(staleMemoryNote('- a (2026-01-01)\n- b (2026-09-01)\n- c no date', d)).toMatch(/^1 line dated more than 90 days ago/)
    expect(staleMemoryNote('- b (2026-09-01)\n- c', d)).toBeUndefined()
  })
})

describe('scheduled task pin (D-084)', () => {
  it('renders the pinned block with a fallback title', async () => {
    const { renderScheduledTask, scheduledRunMarker } = await import('./contextBudget')
    const b = renderScheduledTask('  ', 'Summarise AI news.\n')
    expect(b.startsWith('# Scheduled task (pinned)')).toBe(true)
    expect(b).toContain('"Scheduled task"')
    expect(b.endsWith('Summarise AI news.')).toBe(true)
    expect(renderScheduledTask('Digest', 'x')).toContain('"Digest"')
    const m = scheduledRunMarker('Sep 25, 09:00')
    expect(m.split('\n')[0]).toBe('↻ Scheduled run · Sep 25, 09:00')
    expect(m).toContain('pinned')
  })
})

describe('work folder rules (D-086)', () => {
  it('names the project folder and the added folders, and is absent without a cwd', async () => {
    const { workFolderRules } = await import('./contextBudget')
    expect(workFolderRules(undefined)).toBeUndefined()
    const r = workFolderRules('/Users/x/Proj', ['/Users/x/Shared'])!
    expect(r).toContain('/Users/x/Proj')
    expect(r).toContain('/Users/x/Shared')
    expect(r).toMatch(/inside the project folder/)
    // D-103: build caches stay at the tool's default location, not in the project
    expect(r).toMatch(/DerivedData/)
    expect(r).toMatch(/default location outside the project/)
    expect(workFolderRules('/Users/x/Proj')).not.toContain('additional folders')
  })
})
