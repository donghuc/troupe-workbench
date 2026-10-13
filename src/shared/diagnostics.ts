// "Copy diagnostics" (D-103): one block of text a user can paste into a GitHub issue.
// Pure, so the scrubbing is tested: the home folder becomes ~ (hides the account name and
// private folder names stay relative), and anything that looks like a key or token is masked.
// Logs never hold message text (only activity, tool calls and errors).

export interface DiagnosticsInput {
  app: { version: string; electron: string; node: string; platform: string; arch: string; os: string }
  agents: { name: string; installed: boolean; authenticated: boolean; detail?: string; enabled: boolean }[]
  logTail: string
  home: string
}

const KEY_RES: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,      // OpenAI / Anthropic-style keys
  /\bxai-[A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,           // GitHub tokens
  /\bAIza[0-9A-Za-z_-]{20,}/g                // Google API keys
]
// "Bearer abc…", "token: abc…", "api_key=abc…" — keep the label, mask the value.
const LABELLED_RE = /\b(Bearer|token|apikey|api_key|authorization)(["':=\s]+)(?:Bearer\s+)?[A-Za-z0-9._~+/-]{12,}/gi

export function scrubDiagnostics(text: string, home: string): string {
  let out = text
  if (home && home !== '/') out = out.split(home).join('~')
  out = out.replace(/\/Users\/[^/\s"']+/g, '/Users/…')   // any other account path
  for (const re of KEY_RES) out = out.replace(re, '[redacted]')
  out = out.replace(LABELLED_RE, '$1$2[redacted]')
  return out
}

/** Keep the last `n` lines of a log. */
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  return lines.slice(-n).join('\n')
}

export function buildDiagnostics(d: DiagnosticsInput): string {
  const a = d.app
  const agents = d.agents.map((g) => {
    const state = !g.installed ? 'not installed' : g.authenticated ? 'ready' : 'not signed in'
    return `- ${g.name}: ${state}${g.enabled ? '' : ' (switched off)'}${g.detail ? ` — ${g.detail}` : ''}`
  })
  const text = [
    '### Troupe diagnostics',
    `Troupe ${a.version} · Electron ${a.electron} · Node ${a.node}`,
    `${a.os} (${a.platform} ${a.arch})`,
    '',
    '**Agents**',
    ...agents,
    '',
    '**Recent log** (activity and errors only — no message text)',
    '```',
    d.logTail.trim() || '(empty)',
    '```'
  ].join('\n')
  return scrubDiagnostics(text, d.home)
}
