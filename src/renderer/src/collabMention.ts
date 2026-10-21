// D-129: Collab starts from `@collab` in the composer (it replaced the Chat/Collab switch),
// the way `@debate` starts a thinking mode.
const COLLAB_RE = /(^|\s)@collab\b/i

export const hasCollab = (text: string): boolean => COLLAB_RE.test(text)

/** The goal without the @collab token. */
export const stripCollab = (text: string): string =>
  text.replace(/(^|\s)@collab\b[ \t]?/gi, '$1').replace(/[ \t]{2,}/g, ' ').trim()
