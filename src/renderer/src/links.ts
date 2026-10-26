// Local-file links in agent replies (B-048). react-markdown's default URL sanitizer
// blanks any href whose scheme isn't http(s)/mailto/etc, so an agent's
// [file.md](file:///Users/…/file.md) rendered as a link with href="" that did nothing
// when clicked. File-style schemes are kept here and resolved to a path by normalizeRel.
import { defaultUrlTransform } from 'react-markdown'
import { IS_WINDOWS } from '../../shared/platform'

const FILE_SCHEME = /^(file|computer):\/\//i

export function linkUrlTransform(url: string): string {
  return FILE_SCHEME.test(url.trim()) ? url.trim() : defaultUrlTransform(url)
}

/** A link target as a path: scheme, ./, #anchor, ?query and a trailing :line[:col] removed. */
export function normalizeRel(href: string): string {
  let h = href.trim().replace(/^<|>$/g, '')
  // #anchor and ?query go before decoding, so an encoded # or ? in a file name (%23, %3F) stays
  // part of the name. Then decode every escape: decodeURI kept %26 (&), %2C (,), %3B (;)… as
  // text, so "Systems%20%26%20Ops.pdf" looked for a file named "Systems %26 Ops.pdf" (B-067).
  h = h.split('#')[0].split('?')[0]
  try { h = decodeURIComponent(h) } catch { try { h = decodeURI(h) } catch { /* a bare % in the name: leave as-is */ } }
  if (IS_WINDOWS) h = h.replace(/\\/g, '/').replace(/^file:\/\/\/([a-z]:)/i, '$1')   // D-120: C:\…, file:///C:/…
  h = h.replace(FILE_SCHEME, '').replace(/^\.\//, '')
  return h.replace(/:\d+(?::\d+)?$/, '')   // editor-style "file.md:12" / "file.ts:12:5"
}
