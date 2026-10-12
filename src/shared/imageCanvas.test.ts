import { describe, it, expect } from 'vitest'
import {
  emptyCanvas, makeCard, canConnect, connect, gatherInputs, removeCard, removeSlot, outputImages,
  inputsHash, buildImagePrompt, savedName, withoutRun, findFreeSpot,
  nextCanvasName, parseCanvasIndex, addTab, renameTab, removeTab, copyName, applyRunResult, parseCanvas, imagePathsInReply, processorOf, outputsOf, OUTPUT_SLOT, type Canvas, type Card
} from './imageCanvas'

function setup() {
  let c: Canvas = emptyCanvas()
  const a = makeCard('prompt', 0, 0) as Extract<Card, { kind: 'prompt' }>
  a.data.text = 'a red fox in snow'
  const b = makeCard('media', 0, 200) as Extract<Card, { kind: 'media' }>
  b.data.files = ['inputs/ref1.png', 'inputs/ref2.png']
  const p = makeCard('processor', 400, 0) as Extract<Card, { kind: 'processor' }>
  p.data.slots = ['s1', 's2']
  const d = makeCard('output', 800, 0)
  c = { ...c, cards: [a, b, p, d] }
  return { c, a, b, p, d }
}

describe('image canvas connections', () => {
  it('allows prompt/media → processor and processor → output', () => {
    const { c, a, b, p, d } = setup()
    expect(canConnect(c, a.id, p.id, 's1').ok).toBe(true)
    expect(canConnect(c, b.id, p.id, 's2').ok).toBe(true)
    expect(canConnect(c, p.id, d.id, OUTPUT_SLOT).ok).toBe(true)
  })
  it('refuses wrong kinds, self, unknown slots and loops', () => {
    const { c, a, p, d } = setup()
    expect(canConnect(c, a.id, d.id, OUTPUT_SLOT).ok).toBe(false)      // prompt → output
    expect(canConnect(c, p.id, p.id, 's1').ok).toBe(false)
    expect(canConnect(c, a.id, p.id, 'nope').ok).toBe(false)
    const c2 = connect(c, p.id, d.id, OUTPUT_SLOT)
    expect(canConnect(c2, d.id, p.id, 's1').ok).toBe(false)              // output → its own processor
  })
  it('replaces whatever was in a slot', () => {
    const { c, a, b, p } = setup()
    let c2 = connect(c, a.id, p.id, 's1')
    c2 = connect(c2, b.id, p.id, 's1')
    expect(c2.edges.filter((e) => e.to === p.id && e.slot === 's1').map((e) => e.from)).toEqual([b.id])
  })
  it('removing a card or slot drops its edges; the last slot stays', () => {
    const { c, a, b, p } = setup()
    let c2 = connect(connect(c, a.id, p.id, 's1'), b.id, p.id, 's2')
    expect(removeCard(c2, a.id).edges.length).toBe(1)
    c2 = removeSlot(c2, p.id, 's2')
    expect((c2.cards.find((k) => k.id === p.id) as any).data.slots).toEqual(['s1'])
    expect(c2.edges.length).toBe(1)
    expect((removeSlot(c2, p.id, 's1').cards.find((k) => k.id === p.id) as any).data.slots).toEqual(['s1'])
  })
})

describe('gatherInputs', () => {
  it('joins text in slot order and collects references', () => {
    const { c, a, b, p, d } = setup()
    const c2 = connect(connect(connect(c, b.id, p.id, 's1'), a.id, p.id, 's2'), p.id, d.id, OUTPUT_SLOT)
    expect(gatherInputs(c2, p.id)).toEqual({ prompt: 'a red fox in snow', refs: ['inputs/ref1.png', 'inputs/ref2.png'] })
    expect(processorOf(c2, d.id)?.id).toBe(p.id)
    expect(outputsOf(c2, p.id).map((k) => k.id)).toEqual([d.id])
  })
  it('an output passes its selection, else its latest successful run', () => {
    const out = makeCard('output', 0, 0) as Extract<Card, { kind: 'output' }>
    out.data.runs = [
      { id: 'r1', at: '', agent: 'codex', model: '', files: ['outputs/r1/image-1.png'], inputsHash: '' },
      { id: 'r2', at: '', agent: 'codex', model: '', files: [], error: 'x', inputsHash: '' }
    ]
    expect(outputImages(out)).toEqual(['outputs/r1/image-1.png'])
    out.data.selected = ['outputs/r0/a.png']
    expect(outputImages(out)).toEqual(['outputs/r0/a.png'])
  })
  it('hash changes with inputs or engine', () => {
    const i = { prompt: 'x', refs: [] }
    expect(inputsHash(i, 'codex', '', 1)).toBe(inputsHash({ prompt: 'x', refs: [] }, 'codex', '', 1))
    expect(inputsHash(i, 'codex', '', 1)).not.toBe(inputsHash(i, 'grok', '', 1))
    expect(inputsHash(i, 'codex', '', 1)).not.toBe(inputsHash({ prompt: 'y', refs: [] }, 'codex', '', 1))
  })
})

describe('prompt contract + parsing', () => {
  it('pins count, folder and references', () => {
    const s = buildImagePrompt({ prompt: 'fox', refs: ['inputs/a.png'], count: 2, outDir: 'outputs/run-1' })
    expect(s).toContain('2 separate images')
    expect(s).toContain('- inputs/a.png')
    expect(s).toContain('`outputs/run-1`')
    expect(s.trim().endsWith('fox')).toBe(true)
    expect(buildImagePrompt({ prompt: 'x', refs: [], count: 9, outDir: 'o' })).toContain('4 separate images')
  })
  it('vector agents get an SVG contract', () => {
    const s = buildImagePrompt({ prompt: 'fox', refs: [], count: 1, outDir: 'o', vector: true })
    expect(s).toContain('SVG')
    expect(s).toContain('image-1.svg')
    expect(s).not.toContain('image generation tool.')
  })
  it('self-saving agents are told not to move files', () => {
    const s = buildImagePrompt({ prompt: 'fox', refs: [], count: 1, outDir: 'outputs/r', selfSaving: true })
    expect(s).toContain('Do not try to copy, move')
    expect(s).not.toContain('outputs/r')
    expect(s.trim().endsWith('fox')).toBe(true)
  })
  it('parseCanvas survives junk and drops dangling edges', () => {
    expect(parseCanvas('not json').cards).toEqual([])
    const c = parseCanvas(JSON.stringify({ cards: [{ id: 'a', kind: 'prompt', x: 1, y: 2, data: { text: 'hi' } }, { id: 'z', kind: 'weird' }], edges: [{ id: 'e', from: 'a', to: 'gone', slot: 's' }], view: { zoom: 9 } }))
    expect(c.cards.length).toBe(1)
    expect(c.edges).toEqual([])
    expect(c.view.zoom).toBe(2)
  })
  it('names saved copies by date + prompt + source', () => {
    expect(savedName('Generate a photo of a cute little girl that looks at you', 'outputs/run-abc/image-1.png', new Date(2026, 9, 5)))
      .toBe('2026-10-05-cute-little-girl-looks-image-1.png')
    expect(savedName('', 'outputs/r/image-2.png', new Date(2026, 0, 9))).toBe('2026-01-09-image-2.png')
  })
  it('withoutRun drops the record, selection and saved links of that run', () => {
    const o = makeCard('output', 0, 0) as Extract<Card, { kind: 'output' }>
    o.data.runs = [{ id: 'r1', at: '', agent: 'codex', model: '', files: ['outputs/r1/a.png'], inputsHash: '' }, { id: 'r2', at: '', agent: 'codex', model: '', files: ['outputs/r2/b.png'], inputsHash: '' }]
    o.data.selected = ['outputs/r1/a.png', 'outputs/r2/b.png']
    o.data.saved = { 'outputs/r1/a.png': 'saved/x.png' }
    const n = withoutRun(o, 'r1') as Extract<Card, { kind: 'output' }>
    expect(n.data.runs.map((r) => r.id)).toEqual(['r2'])
    expect(n.data.selected).toEqual(['outputs/r2/b.png'])
    expect(n.data.saved).toEqual({})
  })
  it('finds image paths in a reply', () => {
    expect(imagePathsInReply('outputs/run-1/image-1.png\n`./outputs/run-1/image-2.png`\nSaw [it](generated/x.jpg). Done.'))
      .toEqual(['outputs/run-1/image-1.png', 'outputs/run-1/image-2.png', 'generated/x.jpg'])
  })
})

describe('findFreeSpot', () => {
  it('keeps the start when it is free', () => {
    expect(findFreeSpot([], { x: 10, y: 10 }, { w: 100, h: 100 })).toEqual({ x: 10, y: 10 })
  })
  it('moves off an occupied spot to the nearest free one', () => {
    const taken = [{ x: 0, y: 0, w: 300, h: 200 }]
    const p = findFreeSpot(taken, { x: 50, y: 50 }, { w: 280, h: 160 })
    const hit = p.x < 300 + 24 && p.x + 280 + 24 > 0 && p.y < 200 + 24 && p.y + 160 + 24 > 0
    expect(hit).toBe(false)
  })
})

describe('canvas tabs', () => {
  const ix = { version: 1 as const, tabs: [{ id: 'aaa', name: 'Canvas 1' }, { id: 'bbb', name: 'Logo' }, { id: 'ccc', name: 'Canvas 3' }], active: 'bbb' }
  it('names new canvases with the lowest free number', () => {
    expect(nextCanvasName(ix.tabs)).toBe('Canvas 2')
    expect(nextCanvasName([])).toBe('Canvas 1')
  })
  it('parses the index, dropping junk and fixing active', () => {
    expect(parseCanvasIndex('nope')).toBeNull()
    const p = parseCanvasIndex(JSON.stringify({ tabs: [{ id: 'aaa', name: '  A  ' }, { id: 'aaa', name: 'dup' }, { id: '../x', name: 'bad' }], active: 'zzz' }))
    expect(p).toEqual({ version: 1, tabs: [{ id: 'aaa', name: 'A' }], active: 'aaa' })
  })
  it('adds after a tab and activates it; renames; ignores blank names', () => {
    const a = addTab(ix, 'ddd', undefined, 'aaa')
    expect(a.tabs.map((t) => t.id)).toEqual(['aaa', 'ddd', 'bbb', 'ccc'])
    expect(a.active).toBe('ddd')
    expect(a.tabs[1].name).toBe('Canvas 2')
    expect(renameTab(ix, 'bbb', '  New  name ').tabs[1].name).toBe('New name')
    expect(renameTab(ix, 'bbb', '   ')).toBe(ix)
  })
  it('removing the active tab activates its right neighbour, else the left', () => {
    expect(removeTab(ix, 'bbb').active).toBe('ccc')
    expect(removeTab({ ...ix, active: 'ccc' }, 'ccc').active).toBe('bbb')
    expect(removeTab(ix, 'aaa').active).toBe('bbb')
  })
  it('copy names count up', () => {
    expect(copyName(ix.tabs, 'Logo')).toBe('Logo copy')
    expect(copyName([...ix.tabs, { id: 'x1x', name: 'Logo copy' }], 'Logo')).toBe('Logo copy 2')
  })
  it('applyRunResult appends to outputs or creates one', () => {
    let c: Canvas = emptyCanvas()
    const p = makeCard('processor', 0, 0)
    c = { ...c, cards: [p] }
    const c1 = applyRunResult(c, p.id, { id: 'r1', at: 't', files: ['f.png'], inputsHash: 'h' })
    const outs = c1.cards.filter((k) => k.kind === 'output')
    expect(outs.length).toBe(1)
    expect((outs[0] as any).data.runs[0].agent).toBe('codex')
    const c2 = applyRunResult(c1, p.id, { id: 'r2', at: 't', files: [], error: 'x', inputsHash: 'h' })
    expect((c2.cards.find((k) => k.kind === 'output') as any).data.runs.map((r: any) => r.id)).toEqual(['r1', 'r2'])
    expect(applyRunResult(c, 'missing', { id: 'r', at: '', files: [], inputsHash: '' })).toBe(c)
  })
})
