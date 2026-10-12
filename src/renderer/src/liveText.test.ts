import { describe, it, expect } from 'vitest'
import { laneRenderDelay, LIVE_MIN_MS, LIVE_MAX_MS } from './liveText'

describe('laneRenderDelay (D-098)', () => {
  it('stays at the floor for cheap renders, backs off for expensive ones, caps at the ceiling', () => {
    expect(laneRenderDelay(0)).toBe(LIVE_MIN_MS)
    expect(laneRenderDelay(10)).toBe(LIVE_MIN_MS)
    expect(laneRenderDelay(60)).toBe(180)
    expect(laneRenderDelay(5000)).toBe(LIVE_MAX_MS)
  })
})
