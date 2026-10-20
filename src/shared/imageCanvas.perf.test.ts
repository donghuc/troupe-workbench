import { describe, expect, it } from 'vitest'
import {
  makeCard, connect, canConnect, connectChecker, gatherInputs, gatherInputsIx, indexCanvas, cardViews, stabilize, sourceLabel, OUTPUT_SLOT,
  type Canvas, type Card
} from './imageCanvas'

// Image perf (2026-10): the indexed helpers give the same answers as the plain ones, and stay
// fast on big canvases. A chained graph (each Output feeds the next Processor) is the worst
// case for loop checks — canConnect took 121 ms per pointer move at 500 cards.

function chained(groups: number): Canvas {
  let c: Canvas = { version: 1, cards: [], edges: [], view: { x: 0, y: 0, zoom: 1 } }
  let prev: Card | null = null
  for (let g = 0; g < groups; g++) {
    const p = makeCard('prompt', g * 1500, 0) as Extract<Card, { kind: 'prompt' }>; p.data.text = `prompt ${g}`
    const m = makeCard('media', g * 1500, 240) as Extract<Card, { kind: 'media' }>; m.data.files = [`inputs/${g}.png`]
    const pr = makeCard('processor', g * 1500 + 360, 0) as Extract<Card, { kind: 'processor' }>; pr.data.slots = ['a', 'b', 'c']
    const o = makeCard('output', g * 1500 + 780, 0) as Extract<Card, { kind: 'output' }>
    o.data.runs = [{ id: `r${g}`, at: '2026-10-01T00:00:00Z', agent: 'codex', model: '', files: [`outputs/${g}.png`], inputsHash: 'old' }]
    c = { ...c, cards: [...c.cards, p, m, pr, o] }
    c = connect(c, p.id, pr.id, 'a'); c = connect(c, m.id, pr.id, 'b'); c = connect(c, pr.id, o.id, OUTPUT_SLOT)
    if (prev) c = connect(c, prev.id, pr.id, 'c')
    prev = o
  }
  return c
}
const slotsOf = (k: Card) => (k.kind === 'processor' ? k.data.slots : k.kind === 'output' ? [OUTPUT_SLOT] : [])

describe('indexed canvas helpers (image perf)', () => {
  const c = chained(30)
  it('connectChecker answers exactly like canConnect', () => {
    for (const from of c.cards) {
      const check = connectChecker(c, from.id)
      for (const to of c.cards) for (const s of [...slotsOf(to), 'nope']) expect(check(to.id, s)).toEqual(canConnect(c, from.id, to.id, s))
    }
  })
  it('gatherInputsIx matches gatherInputs', () => {
    const ix = indexCanvas(c)
    for (const k of c.cards) if (k.kind === 'processor') expect(gatherInputsIx(ix, k.id)).toEqual(gatherInputs(c, k.id))
  })
  it('cardViews: slot labels, last run, stale and feeds-on', () => {
    const v = cardViews(c, () => false)
    const pr = c.cards.find((k) => k.kind === 'processor')!
    const o = c.cards.find((k) => k.kind === 'output')!
    expect(v.get(pr.id)!.slots!.map((s) => s.label)).toEqual(['Prompt · “prompt 0”', 'Media · 1 image', 'Empty — drag an output here'])
    expect(v.get(pr.id)!.lastRun).toEqual({ at: '2026-10-01T00:00:00Z', ok: true })
    expect(v.get(o.id)).toMatchObject({ procId: pr.id, stale: true, feedsOn: true, hint: 'prompt 0' })
    expect(cardViews(c, (id) => id === pr.id).get(o.id)!.stale).toBe(false)   // not stale while running
    expect(sourceLabel(undefined)).toBe('Empty — drag an output here')
  })
  it('stabilize keeps the old object for an unchanged view', () => {
    const a = cardViews(c, () => false), b = stabilize(a, cardViews(c, () => false))
    for (const [id, v] of b) expect(v).toBe(a.get(id))
  })
  it('stays fast at 500 and 1000 cards', () => {
    for (const groups of [125, 250]) {
      const big = chained(groups)
      const from = big.cards[big.cards.length - 1].id
      let t = performance.now()
      const check = connectChecker(big, from)
      for (const k of big.cards) for (const s of slotsOf(k)) check(k.id, s)
      const connectMs = performance.now() - t
      t = performance.now()
      cardViews(big, () => false)
      const viewsMs = performance.now() - t
      // Generous ceilings for slow CI machines; locally both are a few ms.
      expect(connectMs).toBeLessThan(50)
      expect(viewsMs).toBeLessThan(100)
    }
  })
})
