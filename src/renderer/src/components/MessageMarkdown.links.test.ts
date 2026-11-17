// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('../api', () => ({ api: { files: { listTree: async () => ({ type: 'dir' }) }, system: { revealItem: vi.fn(async () => true) } } }))
const { default: MessageMarkdown } = await import('./MessageMarkdown')
const { BROWSE_FOLDER_EVENT } = await import('../notices')
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A markdown file's links resolve from its own folder: a sibling folder in the project is not
// "outside project", it opens in Browse files; a link that really leaves the project keeps the chip.
const ROOT = '/Users/me/Projects/Guides'
function mount(text: string, baseDir?: string) {
  const el = document.createElement('div'); document.body.appendChild(el)
  const opened: string[] = []
  act(() => createRoot(el).render(h(MessageMarkdown, { root: ROOT, baseDir, onOpenArtifact: (p: string) => { opened.push(p) }, children: text })))
  return { el, opened }
}

describe('links in a document (D-086 follow-up)', () => {
  it('a sibling folder link is a folder link, not outside the project', async () => {
    const { el } = mount('Connect [figma-mcp-basics](../figma-mcp-basics/).', 'skills/copy-audit')
    expect(el.querySelector('.outside-file')).toBeNull()
    const a = el.querySelector('a.folder-link') as HTMLAnchorElement
    expect(a).not.toBeNull()
    const seen: unknown[] = []
    const on = (e: Event) => { seen.push((e as CustomEvent).detail); e.preventDefault() }
    window.addEventListener(BROWSE_FOLDER_EVENT, on)
    await act(async () => { a.click(); await new Promise((r) => setTimeout(r, 0)) })
    window.removeEventListener(BROWSE_FOLDER_EVENT, on)
    expect(seen).toEqual([{ root: ROOT, rel: 'skills/figma-mcp-basics' }])
  })

  it('a file link opens the file resolved from the document folder', () => {
    const { el, opened } = mount('See [template](assets/writing-guidelines-template.md).', 'skills/copy-audit')
    act(() => { (el.querySelector('a.artifact-link') as HTMLAnchorElement).click() })
    expect(opened).toEqual(['skills/copy-audit/assets/writing-guidelines-template.md'])
  })

  it('a link that leaves the project keeps the chip, with its real path', () => {
    const { el } = mount('See [x](../../../Shared/x.md).', 'skills/copy-audit')
    expect(el.querySelector('.outside-file')?.getAttribute('title')).toContain('/Users/me/Projects/Shared/x.md')
  })

  it('chat replies (no folder) keep resolving from the project', () => {
    const { el, opened } = mount('See [plan](docs/plan.md).')
    act(() => { (el.querySelector('a.artifact-link') as HTMLAnchorElement).click() })
    expect(opened).toEqual(['docs/plan.md'])
  })
})
