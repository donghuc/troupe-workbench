// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('../api', () => ({ api: {} }))
const { default: MessageMarkdown } = await import('./MessageMarkdown')
const { ReplyBlocksContext } = await import('./ReplyBlocks')

// Reply blocks (D-149) in a chat reply: drawn with the context, code without it, a bad block
// keeps its text, a streaming one waits, and a choices answer goes out once and then shows.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fence = (kind: string, json: unknown) => '```troupe-' + kind + '\n' + (typeof json === 'string' ? json : JSON.stringify(json)) + '\n```'
const CHOICES = { id: 'q', title: 'Trip check', groups: [{ label: 'Age range', options: ['18–29', '30–49'] }], submit: 'Check' }

function mount(text: string, opts: { ctx?: boolean; live?: boolean; answers?: [string, string[][]][] } = {}) {
  const el = document.createElement('div'); document.body.appendChild(el)
  const sent: unknown[] = []
  const ctx = opts.ctx === false ? null : { answers: new Map(opts.answers ?? []), answer: (...a: unknown[]) => { sent.push(a) } }
  const root = createRoot(el)
  act(() => root.render(h(ReplyBlocksContext.Provider, { value: ctx }, h(MessageMarkdown, { blocks: { messageId: 'm1', live: opts.live }, children: text }))))
  return { el, sent }
}

describe('reply blocks in a chat reply (D-149)', () => {
  it('draws steps and sources, and leaves other code alone', () => {
    const { el } = mount(['Plan:', fence('steps', { steps: [{ title: 'Day 1', body: 'Rest **well**' }, { title: 'Day 2' }] }), fence('sources', { sources: [{ title: 'Guide', url: 'https://example.com/g' }] }), '```json\n{}\n```'].join('\n\n'))
    expect(el.querySelectorAll('.rb-step').length).toBe(2)
    expect(el.querySelector('.rb-step-body strong')?.textContent).toBe('well')
    expect(el.querySelector('a.rb-source')?.getAttribute('href')).toBe('https://example.com/g')
    expect(el.querySelectorAll('.code-block').length).toBe(1)
  })

  it('shows code when blocks are off, the text and a note when a block is wrong, a placeholder while streaming', () => {
    expect(mount(fence('steps', { steps: [{ title: 'a' }, { title: 'b' }] }), { ctx: false }).el.querySelector('.rb')).toBeNull()
    const bad = mount(fence('steps', '{"steps": [')).el
    expect(bad.querySelector('.code-block')?.textContent).toContain('"steps"')
    expect(bad.querySelector('.rb-invalid')?.textContent).toContain('not valid JSON')
    expect(mount(fence('steps', '{"steps": ['), { live: true }).el.querySelector('.rb-pending')).not.toBeNull()
  })

  it('sends a choices answer once, and shows a saved answer read-only', () => {
    const { el, sent } = mount(fence('choices', CHOICES))
    const btn = el.querySelector('.rb-actions button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    act(() => { (el.querySelectorAll('.rb-option input')[1] as HTMLInputElement).click() })
    expect(btn.disabled).toBe(false)
    act(() => { btn.click() }); act(() => { btn.click() })
    expect(sent).toEqual([['m1', 'q', 'Trip check\nAge range: 30–49', [['30–49']]]])
    const done = mount(fence('choices', CHOICES), { answers: [['m1#q', [['18–29']]]] }).el
    expect(done.querySelector('.rb-done')?.textContent).toBe('Answered')
    expect(done.querySelector('.rb-answer')?.textContent).toBe('Age range18–29')
    expect(done.querySelector('.rb-option')).toBeNull()
  })
})
