// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { makeCard, connect, OUTPUT_SLOT, type Canvas, type Card } from '../../../../shared/imageCanvas'

// Image perf (2026-10): the canvas must not re-render cards while you pan, zoom or drag a
// connection, and must mount only the cards near the viewport. Counts, not timings, so the
// test is stable on any machine. Before the fix, every pointer move re-rendered all cards.

function chained(groups: number): Canvas {
  let c: Canvas = { version: 1, cards: [], edges: [], view: { x: 0, y: 0, zoom: 1 } }
  let prev: Card | null = null
  for (let g = 0; g < groups; g++) {
    const x = (g % 10) * 1500, y = Math.floor(g / 10) * 700
    const p = makeCard('prompt', x, y) as Extract<Card, { kind: 'prompt' }>; p.data.text = `prompt ${g}`
    const m = makeCard('media', x, y + 240) as Extract<Card, { kind: 'media' }>; m.data.files = [`inputs/${g}.png`]
    const pr = makeCard('processor', x + 360, y) as Extract<Card, { kind: 'processor' }>; pr.data.slots = ['a', 'b', 'c']
    const o = makeCard('output', x + 780, y) as Extract<Card, { kind: 'output' }>
    o.data.runs = Array.from({ length: 5 }, (_, r) => ({ id: `r${g}-${r}`, at: '2026-10-01T00:00:00Z', agent: 'codex' as const, model: '', files: [0, 1, 2, 3].map((i) => `outputs/${g}/${r}-${i}.png`), inputsHash: 'old' }))
    c = { ...c, cards: [...c.cards, p, m, pr, o] }
    c = connect(c, p.id, pr.id, 'a'); c = connect(c, m.id, pr.id, 'b'); c = connect(c, pr.id, o.id, OUTPUT_SLOT)
    if (prev) c = connect(c, prev.id, pr.id, 'c')
    prev = o
  }
  return c
}

const w = window as unknown as Record<string, unknown>
let IC: typeof import('./ImageCanvas')
let ImageView: typeof import('./ImageView').default
beforeAll(async () => {
  const noop = () => () => {}
  w.workbench = {
    image: { folder: async () => '/img', canvases: async () => ({ version: 1, active: 'c1', tabs: [{ id: 'c1', name: 'Bench' }] }), load: async () => chained(125), save: async () => {}, onEvent: noop, onDone: noop, cancel: async () => {} },
    system: { logRendererError: async () => {} }
  }
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 1400, bottom: 900, width: 1400, height: 900, toJSON() {} } as DOMRect }
  Element.prototype.scrollIntoView = function () {}
  document.elementFromPoint = () => null
  IC = await import('./ImageCanvas')
  ImageView = (await import('./ImageView')).default
})

const ev = (type: string, x: number, y: number, extra: object = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra })
const frames = async (n = 1) => { for (let i = 0; i < n; i++) await act(() => new Promise((r) => requestAnimationFrame(() => r(null)))) }

describe('Image Creation canvas at 500 cards (image perf)', () => {
  it('mounts only nearby cards and re-renders none while panning, zooming or connecting', async () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(ImageView, { active: true })) })
    for (let i = 0; i < 20 && !host.querySelector('.img-canvas'); i++) await act(() => new Promise((r) => setTimeout(r, 0)))
    const mounted = host.querySelectorAll('[data-card-id]').length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(40)                      // of 500

    const canvasEl = host.querySelector('.img-canvas') as HTMLElement
    let r0 = IC.renderStats.cards
    await act(async () => { canvasEl.dispatchEvent(ev('pointerdown', 500, 500)) })
    for (let i = 1; i <= 30; i++) { await act(async () => { window.dispatchEvent(ev('pointermove', 500 + i * 4, 500 + i * 2)) }); await frames() }
    expect(IC.renderStats.cards - r0).toBe(0)             // the pan itself: no card renders
    await act(async () => { window.dispatchEvent(ev('pointerup', 620, 560)) })
    expect((host.querySelector('.img-layer') as HTMLElement).style.transform).toBe('translate(120px, 60px) scale(1)')

    r0 = IC.renderStats.cards
    for (let i = 0; i < 10; i++) { await act(async () => { canvasEl.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -5, ctrlKey: true, clientX: 600, clientY: 400 })) }); await frames() }
    expect(IC.renderStats.cards - r0).toBe(0)             // zooming: none until the commit

    const ports = host.querySelectorAll('.img-port-out')
    const port = ports[ports.length - 1] as HTMLElement
    await act(async () => { port.dispatchEvent(ev('pointerdown', 300, 300)) })
    r0 = IC.renderStats.cards
    for (let i = 1; i <= 20; i++) { await act(async () => { window.dispatchEvent(ev('pointermove', 300 + i * 5, 300)) }); await frames() }
    expect(IC.renderStats.cards - r0).toBe(0)             // connect-drag moves: none
    await act(async () => { window.dispatchEvent(ev('pointerup', 400, 300)) })

    // Typing in one Prompt re-renders it and the cards that show it (its Processor, its Output).
    const ta = host.querySelector('textarea.img-prompt') as HTMLTextAreaElement
    r0 = IC.renderStats.cards
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, ta.value + 'x')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(IC.renderStats.cards - r0).toBeLessThanOrEqual(3)
    await act(async () => root.unmount())
  }, 30_000)
})
