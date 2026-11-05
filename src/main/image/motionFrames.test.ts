import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({}))
const { framesToRender, probeFrames, describeMetrics } = await import('./motionFrames')

describe('Motion frames (D-148)', () => {
  it('picks start, quarters and the last frame (op is exclusive)', () => {
    expect(framesToRender(0, 90)).toEqual([0, 22, 45, 67, 89])
    expect(framesToRender(10, 11)).toEqual([10, 10, 10, 10, 10])
  })
})

describe('Frame measurements (D-148)', () => {
  const none = { top: false, bottom: false, left: false, right: false }
  it('reports edges touched, tight margins, too little movement and a jumping loop', () => {
    const probe = probeFrames(0, 90, 4)
    expect(probe).toEqual([0, 30, 59, 89])
    const out = describeMetrics({ edges: [{ ...none, left: true }, none, none, none], area: [0.3, 0.3, 0.3, 0.3], steps: [0.01, 0.02, 0.01], seam: 0.2, gap: { left: 0, right: 0.01, top: 0.2, bottom: 0.2 } }, probe)
    expect(out[0]).toMatch(/^Cut off: the artwork touches the left edge of the canvas in frames 0\./)
    expect(out.some((l) => l.startsWith('Very close to the right edge'))).toBe(true)
    expect(out.some((l) => l.includes('barely moves'))).toBe(true)
    expect(out.some((l) => l.includes('it will jump'))).toBe(true)
  })
  it('catches a loop that hitches: same pose at the seam, different speed', () => {
    const out = describeMetrics({ edges: [none, none], area: [0.3, 0.3], steps: [0.2], seam: 0.01, speed: { start: 0.08, end: 0.005 } }, [0, 59])
    expect(out.some((l) => l.startsWith('Loop speed:') && l.includes('slows to a stop at the end'))).toBe(true)
    expect(describeMetrics({ edges: [none, none], area: [0.3, 0.3], steps: [0.2], seam: 0.01, speed: { start: 0.05, end: 0.04 } }, [0, 59]).some((l) => l.startsWith('Loop speed'))).toBe(false)
  })
  it('says a full-canvas fill is probably a background', () => {
    const all = { top: true, bottom: true, left: true, right: true }
    expect(describeMetrics({ edges: [all, all], area: [1, 1], steps: [0.2], seam: 0 }, [0, 9])[0]).toMatch(/fills the whole canvas/)
  })
})
