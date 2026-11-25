// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot } from 'react-dom/client'

const diff = 'diff --git a/a.md b/a.md\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n'
vi.mock('../api', () => ({ api: { changes: { diff: vi.fn(async () => diff) }, settings: { get: async () => '15' } } }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { default: ChangesCard } = await import('./ChangesCard')
const { default: FailureCard } = await import('./FailureCard')
const { default: StreamingActivity } = await import('./StreamingActivity')

function mount(el: ReturnType<typeof h>) { const d = document.createElement('div'); document.body.appendChild(d); act(() => createRoot(d).render(el)); return d }
const changes = { before: 'b', after: 'a', files: [{ path: 'a.md', status: 'M' as const, add: 1, del: 1 }, { path: 'new.md', status: 'A' as const, add: 3, del: 0 }] }

describe('D-151 cards', () => {
  it('Changes card: glance, review a file, restore asks the chat', async () => {
    const restore = vi.fn()
    const d = mount(h(ChangesCard, { messageId: 'm1', changes, busy: false, onRestore: restore, onUndo: async () => {} }))
    expect(d.querySelector('.chg-title')?.textContent).toBe('2 files changed')
    expect(d.querySelector('.chg-head .chg-add')?.textContent).toBe('+4')
    const btns = [...d.querySelectorAll('button')]
    act(() => { btns.find((b) => b.textContent === 'Review changes')!.click() })
    await act(async () => { (d.querySelector('.chg-file-toggle') as HTMLButtonElement).click(); await new Promise((r) => setTimeout(r, 0)) })
    expect([...d.querySelectorAll('.chg-line')].map((l) => l.className.replace('chg-line ', ''))).toEqual(['chg-hunk', 'chg-ctx', 'chg-del', 'chg-add'])
    act(() => { [...d.querySelectorAll('button')].find((b) => b.textContent?.includes('Restore files'))!.click() })
    expect(restore).toHaveBeenCalledWith('m1')
  })
  it('Changes card after a restore offers Undo', () => {
    const d = mount(h(ChangesCard, { messageId: 'm1', changes: { ...changes, restored: { at: Date.now(), safety: 's' } }, busy: false, onRestore: () => {}, onUndo: async () => {} }))
    expect(d.textContent).toMatch(/Restored 2 files to before this reply/)
    expect([...d.querySelectorAll('button')].some((b) => b.textContent === 'Undo restore')).toBe(true)
  })
  it('Failure card says what happened and runs its actions', () => {
    const act1 = vi.fn()
    const d = mount(h(FailureCard, { error: 'Prompt is too long', agent: 'Codex', other: 'Claude', busy: false, onAction: act1 }))
    expect(d.querySelector('.fail-title')?.textContent).toBe('Message too long for Codex')
    act(() => { [...d.querySelectorAll('button')].find((b) => b.textContent === 'Ask Claude instead')!.click() })
    expect(act1).toHaveBeenCalledWith('switch')
  })
  it('live line warns before the quiet timeout and offers Keep waiting', async () => {
    const keep = vi.fn()
    const last = { current: Date.now() - 14 * 60_000 }
    const d = mount(h(StreamingActivity, { activity: { label: 'Running Bash…', startedAt: Date.now() - 20 * 60_000 }, steps: 23, lastOutput: last, onKeepWaiting: keep }))
    expect(d.querySelector('.activity-time')?.textContent).toMatch(/20 min .* · 23 steps/)
    expect(d.querySelector('.activity-warn')?.textContent).toMatch(/No output for 14 min — stops in 1 min/)
    act(() => { (d.querySelector('.activity-warn button') as HTMLButtonElement).click() })
    expect(keep).toHaveBeenCalled()
  })
})
