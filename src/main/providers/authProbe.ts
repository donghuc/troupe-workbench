// Reading a CLI's "am I signed in?" output (2.3). Pure, so each case is tested.

/**
 * `codex login status`: "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1).
 * The old check, /Logged in/i, also matched "Not logged in" — a signed-out Codex showed
 * as Ready. Signed in only when the command succeeded and no line says "not logged in".
 */
export function codexLoggedIn(failed: boolean, text: string): boolean {
  if (failed) return false
  if (/not\s+logged\s+in/i.test(text)) return false
  return /^\s*logged in\b/im.test(text)
}
