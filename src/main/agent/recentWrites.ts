// Files agents wrote recently, by provider (D-087). Grok has no file events of its own,
// so GrokProvider finds "its" images by scanning the project for files newer than the
// run start — which also picked up images another agent wrote in a parallel chat in the
// same project (Codex's avatars showed up in Grok's reply in a parallel chat). Providers that do
// report writes register them here so the scan can leave them out.
import { resolve } from 'path'

const recent: { path: string; provider: string; at: number }[] = []
const KEEP_MS = 30 * 60_000

export function noteWrite(path: string, provider: string): void {
  const now = Date.now()
  recent.push({ path: resolve(path), provider, at: now })
  while (recent.length && now - recent[0].at > KEEP_MS) recent.shift()
  if (recent.length > 2000) recent.splice(0, recent.length - 2000)
}

// Absolute paths written by a provider OTHER than `provider` since `sinceMs`.
export function writtenByOthers(provider: string, sinceMs: number): Set<string> {
  return new Set(recent.filter((r) => r.provider !== provider && r.at >= sinceMs - 2000).map((r) => r.path))
}
