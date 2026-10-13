import { describe, it, expect } from 'vitest'
import { collectChatFiles, replyFiles, fileArtifacts, usageMain, usageBreakdown, toRelPath, userDisplayText } from './chatFiles'
import type { Message } from '../../shared/types'

let n = 0
const msg = (role: 'user' | 'assistant', content: string, metadata: Record<string, unknown> | null = null): Message =>
  ({ id: `m${n++}`, conversationId: 'c', role, provider: role === 'assistant' ? 'codex' : null, content, createdAt: n, metadata })
const cwd = '/Users/me/proj'

describe('chat files (D-098, moved from ConversationView)', () => {
  it('toRelPath strips ./ and the project folder', () => {
    expect(toRelPath(cwd, './a/b.md')).toBe('a/b.md')
    expect(toRelPath(cwd, `${cwd}/docs/x.md`)).toBe('docs/x.md')
    expect(toRelPath(undefined, '/abs/x.md')).toBe('/abs/x.md')
  })

  it('collects linked artifacts and written deliverables, newest first; reads stay working files', () => {
    const msgs = [
      msg('assistant', 'See [old](docs/old.md)', { actions: [{ kind: 'tool', label: 'Read', path: `${cwd}/notes/read.md` }] }),
      msg('assistant', 'Made [report](docs/report.html) and [site](https://x.com/a.html)', { actions: [{ kind: 'file', label: 'Write', path: `${cwd}/out/chart.png` }, { kind: 'tool', label: 'Write', path: `${cwd}/.workbench/tmp/s.md` }] })
    ]
    expect(collectChatFiles(msgs, cwd)).toEqual({ linked: ['docs/report.html', 'docs/old.md', 'out/chart.png'], touched: ['notes/read.md'] })
  })

  it('reply file cards: links (not inline images), then written files; hidden and deleted files dropped', () => {
    const m = msg('assistant', 'Open [plan](PLAN.md), see ![img](a.png), [gone](gone.md), [hid](.x/y.md)', { actions: [{ kind: 'file', path: `${cwd}/out/new.md` }] })
    expect(fileArtifacts(m.metadata, cwd)).toEqual(['out/new.md'])
    expect(replyFiles(m, cwd, new Set(['PLAN.md', 'out/new.md']), new Set(['PLAN.md', 'gone.md', 'out/new.md']))).toEqual(['PLAN.md', 'out/new.md'])
    expect(replyFiles(m, cwd, null, new Set())).toEqual(['PLAN.md', 'gone.md', 'out/new.md'])
  })

  it('usage line and breakdown', () => {
    const a = msg('assistant', 'x', { usage: { inputTokens: 1000, cacheReadTokens: 12000, outputTokens: 300, costUsd: 0.0123 }, modelUsed: 'm-1' })
    expect(usageMain(a)).toBe('13.0k in · 12.0k cached · 300 out · $0.0123 · m-1')
    expect(usageBreakdown(a)).toBe('1,000 new · 12.0k cache-read')
    expect(usageMain(msg('user', 'abcdefgh'))).toBe('~2 tokens')
    expect(usageMain({ role: 'assistant', content: 'abcdefgh', metadata: { modelUsed: 'deepseek/deepseek-flash' } })).toBe('~2 tokens · deepseek/deepseek-flash')
  })

  it('user display text uses the typed part only when selections were attached', () => {
    expect(userDisplayText(msg('user', 'full', { displayText: 'typed', selections: [{ id: 's', text: 'q' }] }))).toBe('typed')
    expect(userDisplayText(msg('user', 'full', { displayText: 'typed' }))).toBe('full')
  })
})
