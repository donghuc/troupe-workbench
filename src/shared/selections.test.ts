import { describe, it, expect } from 'vitest'
import { sourceLine, sourceLabel, quoteWithSource, composeWithSelections, selectionsFromMeta, snippet } from './selections'

const a = { id: 'a', text: 'Calm by default.', source: { path: 'docs/ATLAS.md', heading: '3.  Navigation\n principles' } }
const b = { id: 'b', text: 'line one\nline two', source: { label: "Claude's reply" } }

describe('selection sources', () => {
  it('builds source lines for files, pages and replies', () => {
    expect(sourceLine(a.source)).toBe('From `docs/ATLAS.md` › "3. Navigation principles":')
    expect(sourceLine({ path: 'r.pdf', page: 4 })).toBe('From `r.pdf` › page 4:')
    expect(sourceLine(b.source)).toBe("From Claude's reply:")
    expect(sourceLine(null)).toBeNull()
  })
  it('makes short chip labels', () => {
    expect(sourceLabel(a.source)).toBe('ATLAS.md › 3. Navigation principles')
    expect(sourceLabel({ path: 'x/r.pdf', page: 2 })).toBe('r.pdf › p. 2')
    expect(sourceLabel(null)).toBe('Selection')
  })
  it('quotes multi-line text', () => {
    expect(quoteWithSource('x\ny')).toBe('> x\n> y')
  })
  it('trims snippets', () => {
    expect(snippet('a  b', 10)).toBe('a b')
    expect(snippet('abcdefghijkl', 6)).toBe('abcde…')
  })
})

describe('composeWithSelections', () => {
  it('leaves plain messages alone', () => {
    expect(composeWithSelections(' hi ', [])).toBe('hi')
  })
  it('appends numbered passages with their sources after the typed text', () => {
    expect(composeWithSelections('Compare these', [a, b])).toBe(
      'Compare these\n\n---\nSelected passages (2):\n\n' +
      '[1] From `docs/ATLAS.md` › "3. Navigation principles":\n> Calm by default.\n\n' +
      "[2] From Claude's reply:\n> line one\n> line two")
  })
  it('works with no typed text', () => {
    expect(composeWithSelections('', [a])).toBe('Selected passage:\n\n[1] From `docs/ATLAS.md` › "3. Navigation principles":\n> Calm by default.')
  })
  it('reads selections back from message metadata defensively', () => {
    expect(selectionsFromMeta({ selections: [a, { nope: 1 }, { text: 't' }] }).map((s) => s.text)).toEqual(['Calm by default.', 't'])
    expect(selectionsFromMeta(null)).toEqual([])
  })
})
