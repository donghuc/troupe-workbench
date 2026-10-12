import type { ScheduleKind } from '../../shared/types'

// Next fire time (ms) for a schedule, at or after `from`. Pure (no DB) so it is
// unit-testable (D-060 item 2). 'interval' → from + N minutes; 'daily' → today at
// atMin (minutes after local midnight), or tomorrow if that moment has passed.
export function computeNext(kind: ScheduleKind, intervalMin: number, atMin: number, from: number): number {
  if (kind === 'interval') return from + Math.max(1, intervalMin) * 60_000
  const d = new Date(from)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(atMin / 60), atMin % 60, 0, 0)
  if (next.getTime() <= from) next.setDate(next.getDate() + 1)
  return next.getTime()
}
