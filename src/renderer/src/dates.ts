// Short dates for cards and lists: "Oct 8", or "Oct 8, 2025" when it isn't this year.
// One formatter so Image Creation, Notes and project lists read the same (was 10/8/2026).
export function shortDate(t: number | string | Date, now: Date = new Date()): string {
  const d = t instanceof Date ? t : new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }
  return d.toLocaleDateString('en-US', opts)
}
