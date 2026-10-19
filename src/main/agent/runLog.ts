import { appendFileSync, readFileSync, writeFileSync, statSync, existsSync } from 'fs'
import type { RunLogEntry } from '../../shared/cliProtocol'

// D-118: a small log of finished runs — when, where, by whom, and whether they failed — so
// `troupe runs` can answer "what ran since 10:00?" A failed run that never wrote a reply
// leaves no trace in the chat, so the chat history alone can't say. JSON lines in the
// app's folder (no database change, so older versions still open the data); trimmed to
// the last 2,000 runs. Best-effort: logging never breaks a run.

const MAX_LINES = 2000
const TRIM_AT_BYTES = 1_500_000
let file: string | null = null

export function initRunLog(path: string): void { file = path }

export function appendRunLog(e: RunLogEntry): void {
  if (!file) return
  try {
    appendFileSync(file, JSON.stringify(e) + '\n', { mode: 0o600 })
    if (statSync(file).size > TRIM_AT_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      writeFileSync(file, lines.slice(-MAX_LINES).join('\n') + '\n', { mode: 0o600 })
    }
  } catch { /* best-effort */ }
}

/** Entries that finished at or after `since`, newest first. */
export function readRunLog(since: number): RunLogEntry[] {
  if (!file || !existsSync(file)) return []
  const out: RunLogEntry[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const e = JSON.parse(line) as RunLogEntry; if (e && typeof e.run === 'string' && e.finishedAt >= since) out.push(e) } catch { /* skip a torn line */ }
  }
  return out.sort((a, b) => b.finishedAt - a.finishedAt)
}
