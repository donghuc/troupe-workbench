// D-098: how often a streaming reply re-renders. react-markdown re-parses the whole reply
// on every render, so at 25 updates a second a long reply cost O(n²) and kept the window
// busy for longer than the reply took to arrive. The live lane now re-renders at most
// every MIN ms, backing off to 3× what the last render cost; the final text always
// renders at once.
export const LIVE_MIN_MS = 100
export const LIVE_MAX_MS = 1000
export function laneRenderDelay(lastCostMs: number): number {
  return Math.min(LIVE_MAX_MS, Math.max(LIVE_MIN_MS, Math.round(lastCostMs * 3)))
}
