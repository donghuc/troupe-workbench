// Context budget rules (D-075): keep what Troupe sends every turn small without
// dropping anything the agent needs. Pure helpers so they are unit-tested.

// Pinned files at or under this size are inlined; larger ones are sent as a
// reference the agent opens itself (it runs in the project folder).
export const PINNED_INLINE_MAX = 8 * 1024

// Memory files are re-sent (or re-read natively) on every turn; past this size
// the inspector warns so the user can tidy them.
export const MEMORY_WARN_CHARS = 4 * 1024

// Turns since the latest summary: all are kept, older ones clipped harder than
// the no-summary transcript because the summary already carries their gist.
export const SINCE_SUMMARY_TRANSCRIPT = { maxTurns: 1000, recentFull: 2, oldCap: 600 }

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`

// First Markdown heading (or first non-empty line) — a one-line hint of what the file holds.
export function firstHeading(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const h = lines.find((l) => /^#{1,6}\s/.test(l))
  const line = (h ?? lines[0] ?? '').replace(/^#{1,6}\s+/, '')
  return line.length > 120 ? line.slice(0, 120) + '…' : line
}

// One pinned file as it goes into the persistent-context block.
export function renderPinnedFile(rel: string, text: string, max = PINNED_INLINE_MAX): { text: string; inlined: boolean } {
  if (text.length <= max) return { text: `## ${rel}\n\n${text}`, inlined: true }
  const head = firstHeading(text)
  return {
    inlined: false,
    text: [
      `## ${rel} (reference only, ${kb(text.length)})`,
      '',
      `Too large to include every turn. Open \`${rel}\` from the project folder and read the parts you need when the task depends on it.`,
      ...(head ? [`It starts with: ${head}`] : [])
    ].join('\n')
  }
}

export function memoryWarning(label: string, chars: number): string | undefined {
  if (chars <= MEMORY_WARN_CHARS) return undefined
  return `${label} is ${kb(chars)}. It is loaded on every turn, so keep it under ${kb(MEMORY_WARN_CHARS)}: move details into pinned files or remove stale lines.`
}

// ── Freshness (D-080 item 3, D-082) ──────────────────────────────────────────
// Memory lines Troupe writes end with " (YYYY-MM-DD)". Lines older than STALE_DAYS get
// a quiet note in the inspector; hand-written lines without a date are left alone.
const STALE_DAYS = 90
const dateStamp = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const stampLine = (line: string, d = new Date()): string => (/\(\d{4}-\d{2}-\d{2}\)\s*$/.test(line) ? line : `${line.trimEnd()} (${dateStamp(d)})`)
export function staleMemoryNote(text: string, now = new Date(), days = STALE_DAYS): string | undefined {
  const cutoff = now.getTime() - days * 86_400_000
  const old = text.split('\n').filter((l) => {
    const m = /\((\d{4})-(\d{2})-(\d{2})\)\s*$/.exec(l)
    return m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < cutoff
  })
  if (!old.length) return undefined
  return `${old.length} line${old.length > 1 ? 's' : ''} dated more than ${days} days ago — still true? ${old.slice(0, 2).map((l) => `“${l.trim().slice(0, 60)}”`).join(', ')}${old.length > 2 ? ', …' : ''}`
}

// D-084: a scheduled task that reuses one thread keeps its instruction pinned in the
// context rather than re-sent as a visible message every run. The block sits ahead of
// the summary, so it survives compression and edits to the schedule take effect next run.
export function renderScheduledTask(title: string, prompt: string): string {
  const t = title.trim() || 'Scheduled task'
  return ['# Scheduled task (pinned)', `This thread runs "${t}" on a schedule. Each run below is a repeat of this task:`, '', prompt.trim()].join('\n')
}

// The short visible message a repeat run appends (the task itself is pinned above).
export function scheduledRunMarker(when: string): string {
  return `↻ Scheduled run · ${when}\nRun the pinned scheduled task again. Build on earlier runs — skip anything you've already covered.`
}

// D-086: where an agent may write and look. Files outside the project folder (and the
// added folders) cannot be opened from a reply, and a search across the home folder
// makes macOS ask for Desktop/Documents/Downloads access one prompt at a time.
export function workFolderRules(cwd: string | undefined, addDirs: string[] = []): string | undefined {
  if (!cwd) return undefined
  const extra = addDirs.length ? ` and the additional folders (${addDirs.join(', ')})` : ''
  return [
    `Working folder rules: the project folder is ${cwd}${extra}.`,
    'Save everything you create — screenshots, exports, generated files — inside the project folder (a subfolder such as screenshots/ or generated/ is fine) and link it by a path relative to the project folder; files saved anywhere else cannot be opened from your reply.',
    'Search and read only inside the project folder' + (addDirs.length ? ' and the additional folders' : '') + '. Do not scan the home folder, Desktop, Documents or Downloads, and do not use AppleScript or open other apps to look for files.'
  ].join(' ')
}
