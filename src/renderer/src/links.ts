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
  try { h = decodeURI(h) } catch { /* leave as-is */ }
  if (IS_WINDOWS) h = h.replace(/\\/g, '/').replace(/^file:\/\/\/([a-z]:)/i, '$1')   // D-120: C:\…, file:///C:/…
  h = h.replace(FILE_SCHEME, '').replace(/^\.\//, '')
  h = h.split('#')[0].split('?')[0]
  return h.replace(/:\d+(?::\d+)?$/, '')   // editor-style "file.md:12" / "file.ts:12:5"
}
