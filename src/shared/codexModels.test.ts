import { describe, it, expect } from 'vitest'
import { parseCodexModelsCache, mergeCodexModels, parseExtraModels, migrateCodexModels, modelListFor, allPresetsFor } from './models'

const cache = JSON.stringify({
  fetched_at: '2026-09-24T06:20:00Z',
  models: [
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 12, upgrade: { model: 'gpt-5.6-sol', migration_markdown: 'GPT-5.5 retires on October 14, 2026.' } },
    { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', priority: 2, upgrade: null },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43 },
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', priority: 1 },
    { display_name: 'no slug', visibility: 'list' }
  ]
})

describe('Codex model list (D-076)', () => {
  it('keeps listed models in Codex order, with retirement notes', () => {
    expect(parseCodexModelsCache(cache)).toEqual([
      { v: 'gpt-6-astra', l: 'GPT-6-Astra' },
      { v: 'gpt-6-sol', l: 'GPT-6-Sol' },
      { v: 'gpt-5.5', l: 'GPT-5.5', note: 'GPT-5.5 retires on October 14, 2026.' }
    ])
  })
  it('is empty for a missing or broken file', () => {
    expect(parseCodexModelsCache(null)).toEqual([])
    expect(parseCodexModelsCache('{nope')).toEqual([])
    expect(parseCodexModelsCache('{"models": 3}')).toEqual([])
  })
  it('merges typed models: same id renames, new ids follow', () => {
    const auto = parseCodexModelsCache(cache)
    const merged = mergeCodexModels(auto, [{ v: 'gpt-6-sol', l: 'Sol' }, { v: 'gpt-6-astra', l: 'gpt-6-astra' }, { v: 'o-custom', l: 'Custom' }])
    expect(merged.map((m) => [m.v, m.l])).toEqual([['gpt-6-astra', 'GPT-6-Astra'], ['gpt-6-sol', 'Sol'], ['gpt-5.5', 'GPT-5.5'], ['o-custom', 'Custom']])
  })
})

describe('model lists (D-078)', () => {
  it('parses the global More models field by agent handle', () => {
    const l = parseExtraModels('claude: haiku | Haiku\ncodex: gpt-5.5\nnobody: x\n\ncodex: gpt-5.5 | dup\nnot a line')
    expect(l['claude-code']).toEqual([{ v: 'haiku', l: 'Haiku' }])
    expect(l.codex).toEqual([{ v: 'gpt-5.5', l: 'gpt-5.5' }])
    expect(Object.keys(l).sort()).toEqual(['claude-code', 'codex'])
  })
  it('migrates the old Codex-only field', () => {
    expect(migrateCodexModels('gpt-6-sol | Sol\ngpt-5.5')).toBe('codex: gpt-6-sol | Sol\ncodex: gpt-5.5')
    expect(migrateCodexModels(null)).toBe('')
  })
  it('offers an agent\'s newest three plus typed extras', () => {
    const auto = ['a', 'b', 'c', 'd'].map((v) => ({ v, l: v.toUpperCase() }))
    expect(modelListFor(auto, [{ v: 'd', l: 'D' }, { v: 'x', l: 'X' }]).map((m) => m.v)).toEqual(['a', 'b', 'c', 'd', 'x'])
  })
  it('extras add to or rename an agent\'s presets', () => {
    const lists = parseExtraModels('claude: haiku | Haiku\nclaude: opus | Opus 5')
    expect(allPresetsFor('claude-code', lists).map((m) => m.l)).toEqual(['Default', 'Opus 5', 'Sonnet', 'Fable', 'Haiku'])
  })
})
