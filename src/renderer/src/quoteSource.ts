// Where the current text selection came from (D-065). The artifact viewer marks its
// root with data-artifact-path (a Markdown heading above the selection, or a PDF
// page via data-page-number, narrows it down); conversation messages carry
// data-quote-label ("Claude's reply", "your message"). Formatting lives in
// shared/selections.ts.
import type { QuoteSource } from '../../shared/selections'
export { quoteWithSource, type QuoteSource } from '../../shared/selections'

export function selectionSource(range: Range): QuoteSource | null {
  const start = range.startContainer
  const el = (start.nodeType === 1 ? start : start.parentElement) as Element | null
  if (!el) return null
  const viewer = el.closest('[data-artifact-path]')
  const path = viewer?.getAttribute('data-artifact-path')
  if (viewer && path) {
    const pageAttr = el.closest('[data-page-number]')?.getAttribute('data-page-number')
    if (pageAttr && Number(pageAttr) > 0) return { path, page: Number(pageAttr) }
    let heading: string | undefined
    for (const h of Array.from(viewer.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
      // Last heading at or before the selection start.
      if (h === el || h.contains(el) || (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) heading = h.textContent ?? undefined
      else break
    }
    return heading ? { path, heading } : { path }
  }
  const label = el.closest('[data-quote-label]')?.getAttribute('data-quote-label')
  return label ? { label } : null
}

const BLOCK = 'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, pre, .pdfv-text-layer, .msg-body, .artifact-body'

/** Up to `max` characters of text just before and after the selection, within its block. */
export function selectionContext(range: Range, max = 80): { before: string; after: string } {
  try {
    const start = range.startContainer
    const el = (start.nodeType === 1 ? start : start.parentElement) as Element | null
    const block = el?.closest(BLOCK)
    if (!block) return { before: '', after: '' }
    const pre = document.createRange(); pre.selectNodeContents(block); pre.setEnd(range.startContainer, range.startOffset)
    const post = document.createRange(); post.selectNodeContents(block); post.setStart(range.endContainer, range.endOffset)
    const tidy = (s: string) => s.replace(/\s+/g, ' ')
    return { before: tidy(pre.toString()).slice(-max).trimStart(), after: tidy(post.toString()).slice(0, max).trimEnd() }
  } catch { return { before: '', after: '' } }
}
