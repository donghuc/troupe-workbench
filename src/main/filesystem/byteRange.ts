// HTTP Range parsing for wbfile:// media (video/audio). Chromium's media player asks for byte
// ranges and won't play (or seek) many MP4s when the server answers with the whole file and
// "accept-ranges: none" — e.g. files whose index (moov atom) sits at the end.

/** Video and audio types are served with byte-range support; everything else stays whole-file. */
export function isRangeMedia(mime: string): boolean {
  return /^(video|audio)\//.test(mime)
}

/**
 * Parse a single-range `Range: bytes=…` header against a file of `size` bytes.
 * null = no usable Range header (serve the whole file); 'unsatisfiable' = answer 416.
 * Multi-range requests are answered with their first range.
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=\s*(\d*)\s*-\s*(\d*)/i.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number, end: number
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(m[2])
    if (n === 0) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}
