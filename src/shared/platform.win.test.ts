// The Windows branches of the shared helpers (D-120), run on any OS by pretending to be win32.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const real = process.platform
beforeAll(() => { Object.defineProperty(process, 'platform', { value: 'win32' }); vi.resetModules() })
afterAll(() => { Object.defineProperty(process, 'platform', { value: real }); vi.resetModules() })

describe('shared helpers on Windows', () => {
  it('names and paths', async () => {
    const p = await import('./platform')
    expect(p.IS_WINDOWS).toBe(true)
    expect(p.OS_WORDS.fileManager).toBe('File Explorer')
    expect(p.fileBase('C:\\Users\\h\\proj\\a.ts')).toBe('a.ts')
    expect(p.isAbsPath('C:\\x')).toBe(true)
    expect(p.isAbsPath('c:/x')).toBe(true)
    expect(p.isAbsPath('src/x')).toBe(false)
    expect(p.relUnder('C:\\Users\\H\\Proj\\src\\a.ts', 'c:\\users\\h\\proj')).toBe('src/a.ts')
    expect(p.relUnder('C:/Users/h/proj/src/a.ts', 'C:\\Users\\h\\proj\\')).toBe('src/a.ts')
    expect(p.relUnder('C:\\Users\\h\\projX\\a.ts', 'C:\\Users\\h\\proj')).toBeNull()
  })

  it('project names and broad folders', async () => {
    const w = await import('./welcome')
    expect(w.nameFromFolder('C:\\Users\\h\\Projects\\Troupe\\')).toBe('Troupe')
    expect(w.isBroadFolder('C:\\Users\\h')).toBe(true)
    expect(w.isBroadFolder('C:\\Users\\h\\Documents')).toBe(true)
    expect(w.isBroadFolder('C:\\Users\\h\\Documents\\proj')).toBe(false)
  })

  it('recipes use their Windows install and Gemini says it is unsupported', async () => {
    const r = await import('./agentRecipes')
    expect(r.BUILTIN_RECIPES['claude-code'].install?.cmd).toBe('irm https://claude.ai/install.ps1 | iex')
    expect(r.BUILTIN_RECIPES.codex.install?.host).toBe('chatgpt.com')
    expect(r.BUILTIN_RECIPES.gemini.install).toBeUndefined()
    expect(r.BUILTIN_RECIPES.gemini.unsupported).toMatch(/Windows/)
    expect(r.presetRecipe('cursor')?.install).toBeUndefined()
  })

  it('files changed are project-relative for C:\\ paths', async () => {
    const c = await import('./cliProtocol')
    expect(c.filesChanged([{ actions: [{ kind: 'file', path: 'C:\\Users\\h\\proj\\src\\a.ts' }] }], 'C:\\Users\\h\\proj')).toEqual(['src/a.ts'])
  })
})

describe('recipes on macOS ignore the Windows block', () => {
  it('winVariant only applies when asked', async () => {
    const { parseAgentRecipe, winVariant } = await import('./agentRecipes')
    const raw = { id: 'x', label: 'X', detect: ['x'], install: { cmd: 'curl -fsSL https://a.example/i.sh | sh', host: 'a.example' }, win: { install: null, docs: 'https://a.example/win' } }
    const mac = parseAgentRecipe(raw)
    expect(mac.ok && mac.recipe.install?.host).toBe('a.example')
    const win = parseAgentRecipe(winVariant(raw))
    expect(win.ok && win.recipe.install).toBeUndefined()
    expect(win.ok && win.recipe.docs).toBe('https://a.example/win')
  })
})
