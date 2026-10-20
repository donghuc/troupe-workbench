import { fileBase } from './platform'
// Selected passages attached to a message (Reply on a selection, D-065). Each passage
// keeps where it came from, so the agent knows which file (and heading or page) — or
// which earlier reply — the user means. Pure; shared by the composer, the sent-message
// view and tests.

export interface QuoteSource {
  path?: string       // file in the project (artifact viewer)
  heading?: string    // nearest Markdown heading above the selection
  page?: number       // PDF page
  label?: string      // e.g. "Claude's reply" for text picked in the conversation
}
// before/after: a little of the surrounding text, shown faded around the passage on the
// sent message's quote card (D-066). Display only — not sent to the agent.
export interface SelectionItem { id: string; text: string; source: QuoteSource | null; before?: string; after?: string }

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** "From `docs/a.md` › "Heading":" / "From Claude's reply:" — or null for no source. */
export function sourceLine(src?: QuoteSource | null): string | null {
  if (!src) return null
  if (src.path) {
    const where = src.page ? ` › page ${src.page}` : src.heading ? ` › "${oneLine(src.heading, 120)}"` : ''
    return `From \`${src.path}\`${where}:`
  }
  return src.label ? `From ${oneLine(src.label, 80)}:` : null
}

/** Short label for a chip / list row: file name › heading, page, or the reply label. */
export function sourceLabel(src?: QuoteSource | null): string {
  if (!src) return 'Selection'
  if (src.path) {
    const name = fileBase(src.path) || src.path
    return src.page ? `${name} › p. ${src.page}` : src.heading ? `${name} › ${oneLine(src.heading, 40)}` : name
  }
  return src.label ? oneLine(src.label, 40) : 'Selection'
}

/** Markdown blockquote of `text`, preceded by its source line when there is one. */
export function quoteWithSource(text: string, src?: QuoteSource | null): string {
  const quoted = text.split('\n').map((l) => '> ' + l).join('\n')
  const line = sourceLine(src)
  return line ? `${line}\n${quoted}` : quoted
}

/** First words of a passage for the chip list. */
export const snippet = (text: string, max = 80): string => {
  const t = oneLine(text, max + 1)
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** The message the agent receives: what the user typed, then the numbered passages. */
export function composeWithSelections(text: string, sels: SelectionItem[]): string {
  const typed = text.trim()
  if (!sels.length) return typed
  const block = sels.map((s, i) => `[${i + 1}] ${quoteWithSource(s.text, s.source)}`).join('\n\n')
  const header = sels.length === 1 ? 'Selected passage:' : `Selected passages (${sels.length}):`
  return typed ? `${typed}\n\n---\n${header}\n\n${block}` : `${header}\n\n${block}`
}

/** Selections stored in a message's metadata, validated (older or foreign data is ignored). */
export function selectionsFromMeta(meta: unknown): SelectionItem[] {
  const raw = (meta as { selections?: unknown } | null)?.selections
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is SelectionItem => !!s && typeof (s as SelectionItem).text === 'string')
    .map((s, i) => ({
      id: typeof s.id === 'string' ? s.id : `s${i}`, text: s.text, source: s.source ?? null,
      before: typeof s.before === 'string' ? s.before : undefined, after: typeof s.after === 'string' ? s.after : undefined
    }))
}
