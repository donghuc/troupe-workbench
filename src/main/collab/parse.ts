// Pure parsers for agent output in Collab runs (D-060 item 2: no Electron, testable).

// Reviewers sometimes return findings as objects ({severity, finding, file, line})
// rather than plain strings; coerce so they never render as "[object Object]".
export function findingToText(f: unknown): string {
  if (typeof f === 'string') return f
  if (f && typeof f === 'object') {
    const o = f as Record<string, unknown>
    const main = o.finding ?? o.issue ?? o.text ?? o.message ?? o.description ?? o.title ?? o.summary
    const parts: string[] = []
    if (typeof o.severity === 'string') parts.push(`[${o.severity}]`)
    if (typeof main === 'string') parts.push(main)
    const loc = o.file ?? o.location ?? o.path
    if (typeof loc === 'string') parts.push(`(${loc}${o.line != null ? ':' + String(o.line) : ''})`)
    if (parts.length) return parts.join(' ')
    try { return JSON.stringify(f) } catch { return String(f) }
  }
  return String(f)
}

// The trailing ```json block an agent was told to end with; falls back to the
// first {...} span. null when nothing parses.
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const brace = text.match(/\{[\s\S]*\}/)
  const raw = (fenced ? fenced[1] : brace ? brace[0] : '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}
