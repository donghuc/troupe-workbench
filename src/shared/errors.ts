// Pure helpers for turning thrown values into something a person can read
// (audit #14). Shared so main and renderer word errors the same way; tested
// in errors.test.ts.

const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/

/** The human part of an error: IPC wrapper prefix stripped, never empty. */
export function cleanErrorMessage(err: unknown): string {
  let raw: string
  if (err instanceof Error) raw = err.message
  else if (typeof err === 'string') raw = err
  else if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') raw = (err as { message: string }).message
  else { try { raw = JSON.stringify(err) ?? String(err) } catch { raw = String(err) } }
  const msg = raw.replace(IPC_PREFIX, '').trim()
  return msg || 'Unknown error'
}

/** Stack if there is one, capped so a runaway trace can't flood the log or clipboard. */
export function errorStack(err: unknown, max = 4000): string | undefined {
  const s = err instanceof Error ? err.stack : undefined
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s
}

/** Plain-text block for "Copy details" and bug reports. */
export function formatErrorDetails(where: string, err: unknown, extra?: string): string {
  const lines = [`Where: ${where}`, `Error: ${cleanErrorMessage(err)}`]
  if (extra) lines.push(extra)
  const stack = errorStack(err)
  if (stack) lines.push('', stack)
  return lines.join('\n')
}
