// Small pure helpers for bounded buffers and temp-folder hygiene (audit #10).

/** Append `chunk`, keeping only the last `max` characters (a CLI's stderr can be huge). */
export function appendCapped(buf: string, chunk: string, max = 64 * 1024): string {
  const next = buf + chunk
  return next.length > max ? '…(earlier output truncated)\n' + next.slice(next.length - max) : next
}

/** Our temp folder prefixes (Claude system-prompt file, PDF extraction script). */
const TEMP_PREFIXES = ['workbench-ctx-', 'wb-pdf-']

/** Names of our temp folders older than `maxAgeMs` — leftovers from earlier runs or crashes. */
export function staleTempDirs(entries: { name: string; mtimeMs: number; isDir: boolean }[], now: number, maxAgeMs = 24 * 60 * 60 * 1000): string[] {
  return entries
    .filter((e) => e.isDir && TEMP_PREFIXES.some((p) => e.name.startsWith(p)) && now - e.mtimeMs > maxAgeMs)
    .map((e) => e.name)
}

/** Whether a log file of `size` bytes should be rotated. */
export const shouldRotate = (size: number, max = 5 * 1024 * 1024): boolean => size >= max
