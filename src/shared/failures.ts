// Failures in plain words (D-151 B): an agent's error text → what happened, why, and the one or
// two things you can do next. Agents report errors as free text, so this matches the common
// wordings; anything else falls back to "didn't finish" with the original text under Details.

export type FailureKind = 'too-long' | 'signed-out' | 'limit' | 'missing' | 'timeout' | 'network' | 'sandbox' | 'other'
export type FailureAction = 'compress' | 'switch' | 'setup' | 'retry' | 'continue' | 'wait'

const RULES: [FailureKind, RegExp][] = [
  ['timeout', /stopped after \d+ min without any output|still running after \d+ min|didn't finish within|timed out/i],
  ['too-long', /prompt is too long|too many tokens|context[ _-]?(length|window)|maximum context|input is too long|exceeds? (the )?(model'?s? )?(context|maximum|token limit)|request too large/i],
  ['limit', /usage limit|rate[ _-]?limit|quota|\b429\b|limit reached|too many requests|overloaded|credit balance/i],
  ['signed-out', /not (logged|signed) in|please (log|sign) ?in|\/login|unauthori[sz]ed|\b401\b|invalid api key|authentication|session (has )?expired|re-?authenticate|token (has )?expired/i],
  ['missing', /CLI not found|not found\. Check it's installed|ENOENT|failed to start/i],
  ['sandbox', /sandbox required but unavailable|sandbox/i],
  ['network', /ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|getaddrinfo|socket hang up|network (error|is unreachable)|fetch failed/i]
]

export function failureKind(message: string): FailureKind {
  for (const [k, re] of RULES) if (re.test(message)) return k
  return 'other'
}

/** "resets at 14:00" / "try again in 2 hours" / Claude's "…|1767096000" epoch → a short phrase, if any. */
export function resetHint(message: string, now = Date.now()): string | null {
  const epoch = /\|(\d{10})\b/.exec(message)
  if (epoch) {
    const at = Number(epoch[1]) * 1000
    if (at > now) {
      const mins = Math.round((at - now) / 60000)
      const when = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return `It resets at ${when} (in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}).`
    }
  }
  const m = /(resets?|try again|available again)\s+(at|in|after)\s+([^.\n|]{2,40})/i.exec(message)
  return m ? `It ${m[1].toLowerCase().startsWith('reset') ? 'resets' : 'is available again'} ${m[2].toLowerCase()} ${m[3].trim()}.` : null
}

export interface Failure { kind: FailureKind; title: string; body: string; actions: FailureAction[]; details: string }

/** What to show for a failed reply from `agent` (its display name); `other` = another agent's name, if one is on. */
export function describeFailure(message: string, agent: string, other?: string): Failure {
  const kind = failureKind(message)
  const details = message.trim().slice(0, 2000)
  const sw: FailureAction[] = other ? ['switch'] : []
  switch (kind) {
    case 'too-long': return { kind, title: `Message too long for ${agent}`, body: 'The conversation, attachments and this message together are more than it can read at once. Compress the conversation, or remove large attachments and send again.', actions: ['compress', ...sw], details }
    case 'limit': return { kind, title: `${agent}’s usage limit is reached`, body: resetHint(message) ?? 'Your plan’s limit for now is used up. Try again later, or ask another agent.', actions: [...sw, 'retry'], details }
    case 'signed-out': return { kind, title: `${agent} isn’t signed in`, body: 'Its sign-in has ended or was never set up. Sign in again, then retry.', actions: ['setup', 'retry'], details }
    case 'missing': return { kind, title: `${agent} isn’t installed or can’t start`, body: 'Troupe couldn’t start its command-line tool. Check it in Settings ▸ Agents.', actions: ['setup', ...sw], details }
    case 'timeout': return { kind, title: `${agent} was stopped`, body: /without any output/i.test(message) ? 'It went quiet for longer than the run timeout (Settings ▸ Conversations). Anything it wrote is kept above.' : 'It ran longer than the overall limit. Anything it wrote is kept above.', actions: ['continue', 'retry'], details }
    case 'network': return { kind, title: `${agent} couldn’t reach its service`, body: 'The connection failed. Check the internet connection, then retry.', actions: ['retry'], details }
    case 'sandbox': return { kind, title: `${agent} couldn’t start its sandbox`, body: 'Auto runs commands in a sandbox, and it didn’t start. Retry, or switch the chat to Read-only.', actions: ['retry', 'setup'], details }
    default: return { kind, title: `${agent} didn’t finish`, body: 'It stopped with an error. The details below are its own words.', actions: ['retry', ...sw], details }
  }
}

/** The short tag on a reply that ended early (metadata from the runner). */
export function stoppedTag(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  if (meta.stoppedByUser) return 'Stopped by you'
  if (!meta.partial) return null
  const err = typeof meta.stopError === 'string' ? meta.stopError : ''
  if (meta.timedOut) { const m = /after (\d+) min without/i.exec(err); return m ? `Stopped early · no output for ${m[1]} min` : 'Stopped early · ran too long' }
  const k = failureKind(err)
  return k === 'other' ? 'Stopped early · error' : `Stopped early · ${({ 'too-long': 'message too long', limit: 'usage limit', 'signed-out': 'signed out', missing: 'couldn’t start', timeout: 'timed out', network: 'connection failed', sandbox: 'sandbox failed' } as Record<string, string>)[k]}`
}
