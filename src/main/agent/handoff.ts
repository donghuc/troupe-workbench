import type { Message, ProviderId } from '../../shared/types'
import { providerLabel } from '../../shared/providers'


// Older turns are clipped to keep the injected block small; the most recent
// turns are kept nearly whole so the next agent in a chain sees the prior reply
// in full (B-014 — a small cap silently truncated the immediately-preceding
// reply, so the second agent argued against half an argument).
// Token optimization (2026-09-14): the injected transcript is the volatile block
// re-cached every turn (cache-write). Trimming older turns here directly shrinks
// it. Compression INPUT must stay faithful, so it opts into COMPRESS_TRANSCRIPT.
const OLD_TURN_CAP = 1000
const RECENT_TURN_CAP = 8000
const clip = (s: string, cap: number) => (s.length > cap ? s.slice(0, cap) + '…' : s)

export interface TranscriptOpts { maxTurns?: number; recentFull?: number; oldCap?: number; recentCap?: number }

// Fuller caps for building a compression prompt — summaries must not be built
// from over-clipped turns, so older turns get much more room here.
export const COMPRESS_TRANSCRIPT: TranscriptOpts = { maxTurns: 1000, recentFull: 2, oldCap: 4000, recentCap: 10000 }

// Labelled transcript lines only (no header).
export function formatTranscript(msgs: Message[], opts: TranscriptOpts = {}): string {
  const { maxTurns = 20, recentFull = 2, oldCap = OLD_TURN_CAP, recentCap = RECENT_TURN_CAP } = opts
  const recent = msgs.slice(-maxTurns)
  const n = recent.length
  return recent.map((m, i) => {
    const who = m.role === 'user' ? 'User' : providerLabel(m.provider)
    const cap = i >= n - recentFull ? recentCap : oldCap
    return `${who}: ${clip(m.content, cap)}`
  }).join('\n\n')
}

// Full shared-conversation block (used when there is no snapshot yet).
export function buildContextBlock(msgs: Message[], maxTurns = 20): string {
  if (msgs.length === 0) return ''
  return [
    '# Shared conversation so far',
    'This is one AI Workbench conversation in a project. Multiple assistants (Claude and Codex) take turns in it as the user switches between them or addresses one directly with an @mention (e.g. "@codex"), and Workbench keeps the shared history. Each turn below is labelled with its author. Treat this as the conversation you are part of and continuing; when the user addressed another assistant, you may still build on or respond to that exchange.',
    '',
    formatTranscript(msgs, { maxTurns }),
    '',
    "Respond to the User's latest message (shown below) using this shared context."
  ].join('\n')
}
