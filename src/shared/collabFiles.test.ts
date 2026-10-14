import { describe, expect, it } from 'vitest'
import { filesFromReply, missingOutputs, scopePaths } from './collabFiles'

const D = 'collab/2026-10-14-here-initial-prompt-get'
describe('scopePaths', () => {
  it('reads outputs and read-only inputs from real plan scopes', () => {
    expect(scopePaths(`${D}/audit/fact-check.md (read-only: uplifting-news-10.md)`)).toEqual({ outputs: [`${D}/audit/fact-check.md`], inputs: ['uplifting-news-10.md'] })
    expect(scopePaths(`${D}/synthesis.md, ${D}/new-prompt.md`).outputs).toEqual([`${D}/synthesis.md`, `${D}/new-prompt.md`])
    expect(scopePaths(`${D}/dry-run/ (prompt's output file redirected here + dry-run-notes.md)`)).toEqual({ outputs: [`${D}/dry-run/`], inputs: [] })
  })
  it('handles backticked paths with spaces and ignores urls / app folder / vague scopes', () => {
    expect(scopePaths('`build archive/notes v2.md`').outputs).toEqual(['build archive/notes v2.md'])
    expect(scopePaths('https://example.com/a.html and .workbench/collab/x/STATUS.md').outputs).toEqual([])
    expect(scopePaths('entire collab folder').outputs).toEqual([])
    expect(scopePaths('collab/x/synthesis.md from judgements/*.md').outputs).toEqual(['collab/x/synthesis.md'])
  })
})

describe('missingOutputs', () => {
  it('needs non-empty files and non-empty folders', () => {
    const fs: Record<string, { kind: 'file' | 'dir' | 'none'; size: number; hasFiles?: boolean }> = {
      'a.md': { kind: 'file', size: 10 }, 'empty.md': { kind: 'file', size: 0 }, out: { kind: 'dir', size: 0, hasFiles: false }
    }
    const probe = (p: string) => fs[p] ?? { kind: 'none' as const, size: 0 }
    expect(missingOutputs(['a.md', 'empty.md', 'gone.md', 'out/'], probe)).toEqual(['empty.md', 'gone.md', 'out/'])
  })
})

describe('filesFromReply', () => {
  const want = [`${D}/judgements/x-opencode.md`]
  it('takes FILE blocks, matching relative names, only for missing outputs', () => {
    const reply = `Here you go.\n=== FILE: judgements/x-opencode.md ===\n# Judgement\nbody\n=== END FILE ===\n=== FILE: other.md ===\nx\n=== END FILE ===\n\`\`\`json\n{"status":"done"}\n\`\`\``
    expect(filesFromReply(reply, want)).toEqual([{ path: want[0], content: '# Judgement\nbody\n' }])
  })
  it('uses the whole reply for a single missing file when no blocks are given', () => {
    expect(filesFromReply('# Judgement\ntext\n```json\n{"status":"done"}\n```', want)).toEqual([{ path: want[0], content: '# Judgement\ntext\n' }])
    expect(filesFromReply('```json\n{"status":"done"}\n```', want)).toEqual([])
    expect(filesFromReply('text', [...want, `${D}/b.md`])).toEqual([])
  })
})
