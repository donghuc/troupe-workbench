import { describe, it, expect } from 'vitest'
import { validateLottie, buildMotionPrompt, repairPrompt, reviewPrompt, isMotionAgent } from './motion'
import { parseCanvas } from './imageCanvas'

const anim = (over: Record<string, unknown> = {}) => JSON.stringify({
  v: '5.7.0', fr: 60, ip: 0, op: 144, w: 512, h: 512, ddd: 0, assets: [],
  layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'leaf-1', ip: 0, op: 144, st: 0,
    ks: { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [256, 256] }, s: { a: 1, k: [{ t: 0, s: [0, 0], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } }, { t: 30, s: [100, 100] }] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    shapes: [{ ty: 'gr', it: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [80, 120] } }, { ty: 'fl', c: { a: 0, k: [0.2, 0.5, 0.3, 1] }, o: { a: 0, k: 100 } }, { ty: 'tr', p: { a: 0, k: [0, 0] } }] }] }],
  ...over
})

describe('validateLottie (D-148)', () => {
  it('accepts a small valid animation and reads its size and length', () => {
    const r = validateLottie(anim())
    expect(r).toEqual({ ok: true, info: { w: 512, h: 512, fr: 60, frames: 144, seconds: 2.4, layers: 1 } })
  })
  it('names what is wrong, for the repair round', () => {
    const bad = (s: string) => { const r = validateLottie(s); return r.ok ? [] : r.problems }
    expect(bad('{oops')[0]).toMatch(/Not valid JSON/)
    expect(bad(anim({ op: 0 }))).toContain('"op" must be greater than "ip"')
    expect(bad(anim({ layers: [] }))).toContain('"layers" must be a non-empty array')
    expect(bad(anim({ fr: 'sixty' }))).toContain('"fr" must be a number')
    expect(bad(JSON.stringify({ ...JSON.parse(anim()), layers: [{ ty: 5, ind: 1, ks: {} }] }))).toContain('layer 1: text layers aren\'t allowed')
    expect(bad(JSON.stringify({ ...JSON.parse(anim()), layers: [{ ty: 4, ind: 1, shapes: [], ks: { p: { a: 1, k: [] } } }] }))[0]).toMatch(/animated but has no keyframes/)
    const two = JSON.parse(anim()); two.layers.push({ ...two.layers[0] })
    expect(bad(JSON.stringify(two))[0]).toMatch(/"ind" 1 is used twice/)
  })
})

describe('Motion prompts', () => {
  it('a new animation: brief, length, assets, the file to write, the rules', () => {
    const p = buildMotionPrompt({ prompt: 'Leaves grow in', refs: ['inputs/logo.svg', 'inputs/ref.mp4'], seconds: 2.4, outFile: 'outputs/run-1/animation.json' })
    expect(p).toContain('Brief: Leaves grow in')
    expect(p).toContain('Length: 2.4 s.')
    expect(p).toContain('inputs/logo.svg (SVG: rebuild its shapes as Lottie layers, keeping its look exactly')
    expect(p).toContain('inputs/ref.mp4 (video: a reference')
    expect(p).toContain('Write the final file to outputs/run-1/animation.json')
    expect(p).toContain('Lottie rules')
    expect(p).toContain('no real browser')
    expect(p).toContain('npm install --prefix /tmp/troupe-motion-tools')
    expect(p).toContain('Loop only when the brief asks')
    expect(p).toContain('Draw the still artwork first')
    expect(p).toContain('match it faithfully')
  })
  it('a change edits the current animation into a new file', () => {
    const p = buildMotionPrompt({ prompt: 'x', refs: [], seconds: 3, outFile: 'outputs/run-2/animation.json', base: 'outputs/run-1/animation.json', change: 'slower leaves' })
    expect(p).toContain('Current animation: outputs/run-1/animation.json')
    expect(p).toContain('Change requested: slower leaves')
    expect(p).toContain("Don't modify outputs/run-1/animation.json")
    expect(p).toContain('outputs/run-1/work/ may hold the script')
    expect(p).toContain('outputs/run-1/work/frames/')
  })
  it('repair lists the problems', () => {
    expect(repairPrompt('a.json', ['"op" must be greater than "ip"'])).toContain('- "op" must be greater than "ip"')
  })
  it('Claude, Codex and Grok make motion', () => {
    expect(['claude-code', 'codex', 'grok'].every(isMotionAgent)).toBe(true)
    expect(isMotionAgent('gemini')).toBe(false)
  })
})

describe('Result size (D-148)', () => {
  it('keeps a resized Result within bounds', () => {
    const c = parseCanvas(JSON.stringify({ version: 1, edges: [], view: {}, cards: [
      { id: 'o1', kind: 'output', x: 0, y: 0, data: { runs: [], w: 99999, h: 50 } },
      { id: 'o2', kind: 'output', x: 0, y: 0, data: { runs: [] } }] }))
    const [a, b] = c.cards
    expect(a.kind === 'output' && [a.data.w, a.data.h]).toEqual([1400, 200])
    expect(b.kind === 'output' && b.data.w).toBeUndefined()
  })
})

describe('Review pass (D-148)', () => {
  it('shows the agent Troupe\'s frames and asks it to fix or leave the file', () => {
    const p = reviewPrompt({ outFile: 'outputs/run-2/animation.json', sheet: 'outputs/run-2/work/frames/sheet.png', frames: ['outputs/run-2/work/frames/frame-0000.png'], brief: 'walk loop', refs: ['inputs/char.png'] })
    expect(p).toContain('Contact sheet, start · ¼ · ½ · ¾ · end: outputs/run-2/work/frames/sheet.png')
    expect(p).toContain('- inputs/char.png')
    expect(p).toContain('If it all looks right, change nothing.')
    expect(p).not.toContain('Change requested')
  })
})

describe('Animate card on the Image canvas (D-148)', () => {
  it('is a run card in animate mode; its Output becomes a player', async () => {
    const { makeCard, connect, emptyCanvas, cardViews, cardLabel, runSize, parseCanvas: parse, OUTPUT_SLOT } = await import('./imageCanvas')
    const q = makeCard('processor', 0, 0, { agent: 'claude-code', animate: true })
    const img = makeCard('processor', 0, 0)
    const o = makeCard('output', 400, 0)
    expect(cardLabel(q)).toBe('Animate')
    expect(cardLabel(img)).toBe('Image')
    expect(q.kind === 'processor' && runSize(q.data)).toBe(0)   // Auto length by default
    const c = connect({ ...emptyCanvas(), cards: [q, img, o] }, q.id, o.id, OUTPUT_SLOT)
    expect(cardViews(c, () => false).get(o.id)?.animate).toBe(true)
    const back = parse(JSON.stringify(c)).cards.find((k) => k.id === q.id)
    expect(back?.kind === 'processor' && back.data.mode).toBe('animate')
  })
})

describe('Auto length (D-148)', () => {
  it('lets the agent pick the natural length', () => {
    const p = buildMotionPrompt({ prompt: 'walk loop', refs: [], seconds: 0, outFile: 'outputs/run-1/animation.json' })
    expect(p).toContain('Length: you choose')
    expect(p).toContain('exactly one cycle')
  })
  it('passes Troupe\'s measurements to the review', () => {
    const p = reviewPrompt({ outFile: 'a.json', sheet: 's.png', frames: [], refs: [], checks: ['Cut off: the artwork touches the left edge of the canvas in every frame.'] })
    expect(p).toContain('Troupe measured 16 frames')
    expect(p).toContain('- Cut off: the artwork touches the left edge')
  })
})

describe('Motion guide (D-148, adapted from diffusionstudio/lottie)', () => {
  it('picks a recipe from the brief and adds the SVG recipe for SVG assets', async () => {
    const { pickRecipes } = await import('./motionGuide')
    expect(pickRecipes('He is walking in the same place, used as a loader', [])).toEqual(['character'])
    expect(pickRecipes('Spinner for the loading screen', [])).toEqual(['loader'])
    expect(pickRecipes('Reveal our logo', ['inputs/logo.svg'])).toEqual(['logo', 'svg'])
  })
  it('puts easing anchors and review blockers in the prompts', () => {
    const p = buildMotionPrompt({ prompt: 'a mascot waves', refs: [], seconds: 0, outFile: 'outputs/run-1/animation.json' })
    expect(p).toContain('settle-soft (0, 0.65, 0.51, 0.99)')
    expect(p).toContain('Recipe — character / mascot')
    expect(reviewPrompt({ outFile: 'a.json', sheet: 's.png', frames: [], refs: [] })).toContain('Automatic fails')
  })
})
