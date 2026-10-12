import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  MIRROR_MARK, readMemoryFile, resolveProjectMemory, isMirrorOf, memoryDelivery, globalMemoryDelivery
} from './memoryDelivery'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wb-mem-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const canonical = '# Memory\n\n- The marker word is OTTER-9.'
const writeClaude = (text = canonical) => writeFileSync(join(dir, 'CLAUDE.md'), text)
const writeAgents = (text: string) => writeFileSync(join(dir, 'AGENTS.md'), text)
const mirrorOf = (text: string) => `${MIRROR_MARK}\n\n${text}`

describe('readMemoryFile / resolveProjectMemory', () => {
  it('returns null with no folder or no file', () => {
    expect(readMemoryFile(null)).toBeNull()
    expect(readMemoryFile(dir)).toBeNull()
  })
  it('prefers the folder CLAUDE.md over the DB blob (B1)', () => {
    writeClaude()
    expect(resolveProjectMemory({ folderPath: dir, memory: 'stale db blob' })).toBe(canonical)
  })
  it('falls back to the DB blob when the folder has no CLAUDE.md', () => {
    expect(resolveProjectMemory({ folderPath: dir, memory: '  db blob  ' })).toBe('db blob')
  })
  it('is empty for a folderless project with no blob', () => {
    expect(resolveProjectMemory({ folderPath: null, memory: '' })).toBe('')
  })
})

describe('isMirrorOf', () => {
  it('is true only for a marked file whose body matches', () => {
    writeAgents(mirrorOf(canonical))
    expect(isMirrorOf(join(dir, 'AGENTS.md'), canonical)).toBe(true)
  })
  it('is false for a hand-written file (no marker), even with identical text', () => {
    writeAgents(canonical)
    expect(isMirrorOf(join(dir, 'AGENTS.md'), canonical)).toBe(false)
  })
  it('is false for a stale mirror (marked, body differs)', () => {
    writeAgents(mirrorOf('old text'))
    expect(isMirrorOf(join(dir, 'AGENTS.md'), canonical)).toBe(false)
  })
  it('is false when the file is missing', () => {
    expect(isMirrorOf(join(dir, 'AGENTS.md'), canonical)).toBe(false)
  })
})

describe('memoryDelivery (project scope)', () => {
  it("is 'none' when there is nothing to deliver", () => {
    expect(memoryDelivery('codex', dir, '   ')).toBe('none')
  })
  it("is 'injected' for a folderless project", () => {
    expect(memoryDelivery('claude-code', null, 'blob')).toBe('injected')
  })
  it("is 'injected' when only the DB blob exists (folder without CLAUDE.md)", () => {
    expect(memoryDelivery('claude-code', dir, 'blob')).toBe('injected')
    expect(memoryDelivery('codex', dir, 'blob')).toBe('injected')
  })
  it("Claude is 'native' whenever the folder CLAUDE.md exists", () => {
    writeClaude()
    expect(memoryDelivery('claude-code', dir, canonical)).toBe('native')
  })
  it("Codex is 'injected' with no AGENTS.md (the Novel Writing case, B2)", () => {
    writeClaude()
    expect(memoryDelivery('codex', dir, canonical)).toBe('injected')
  })
  it("Codex is 'injected' with a hand-written AGENTS.md (no marker)", () => {
    writeClaude(); writeAgents('DO NOT hallucinate.')
    expect(memoryDelivery('codex', dir, canonical)).toBe('injected')
  })
  it("Codex is 'injected' with a stale mirror (CLAUDE.md edited outside the app)", () => {
    writeClaude('# Memory\n\n- The marker word is now LYNX-3.'); writeAgents(mirrorOf(canonical))
    expect(memoryDelivery('codex', dir, 'The marker word is now LYNX-3.')).toBe('injected')
  })
  it("Codex is 'native' with a faithful mirror", () => {
    writeClaude(); writeAgents(mirrorOf(canonical))
    expect(memoryDelivery('codex', dir, canonical)).toBe('native')
  })
  it("Grok is always 'injected' (no native memory file)", () => {
    writeClaude(); writeAgents(mirrorOf(canonical))
    expect(memoryDelivery('grok', dir, canonical)).toBe('injected')
  })
})

describe('globalMemoryDelivery', () => {
  it("is 'none' for empty global memory", () => {
    expect(globalMemoryDelivery('codex', '', join(dir, 'AGENTS.md'))).toBe('none')
  })
  it("Claude is always 'native' (~/.claude/CLAUDE.md is canonical)", () => {
    expect(globalMemoryDelivery('claude-code', 'rules', join(dir, 'AGENTS.md'))).toBe('native')
  })
  it("Codex is 'injected' when ~/.codex/AGENTS.md is hand-written (B3)", () => {
    writeAgents('DO NOT hallucinate.')
    expect(globalMemoryDelivery('codex', 'rules', join(dir, 'AGENTS.md'))).toBe('injected')
  })
  it("Codex is 'native' when the global mirror is faithful", () => {
    writeAgents(mirrorOf('rules'))
    expect(globalMemoryDelivery('codex', 'rules', join(dir, 'AGENTS.md'))).toBe('native')
  })
})
