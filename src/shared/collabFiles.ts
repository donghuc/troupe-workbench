// Pure helpers for what a Collab task must produce (D-108). The orchestrator uses them to
// check a Maker's deliverables exist before spending a Reviewer run, and to save the files
// for agents that can only reply with text (user-added CLIs Troupe can't give file access).

/** Paths named in a task scope: outputs outside parentheses; inputs in "(read-only: …)". */
export function scopePaths(scope: string): { outputs: string[]; inputs: string[] } {
  const outputs: string[] = [], inputs: string[] = []
  // split into top-level text and parenthesised groups
  let depth = 0, buf = '', top = ''
  const groups: string[] = []
  for (const ch of scope) {
    if (ch === '(') { if (depth === 0) { buf = '' } else buf += ch; depth++; continue }
    if (ch === ')' && depth > 0) { depth--; if (depth === 0) groups.push(buf); else buf += ch; continue }
    if (depth > 0) buf += ch; else top += ch
  }
  if (depth > 0) groups.push(buf) // unclosed paren
  for (const p of pathsIn(top)) if (!outputs.includes(p)) outputs.push(p)
  for (const g of groups) {
    const m = g.match(/^\s*read[- ]only\s*:?([\s\S]*)$/i)
    if (m) for (const p of pathsIn(m[1])) if (!inputs.includes(p)) inputs.push(p)
  }
  return { outputs: outputs.filter((p) => !inputs.includes(p)), inputs }
}

// File paths (with an extension) or folder paths (ending in /). Backticked text is taken
// whole, so paths with spaces work when quoted. URLs and the app's hidden folder are skipped.
function pathsIn(text: string): string[] {
  const out: string[] = []
  const push = (raw: string) => {
    const p = raw.trim().replace(/^\.\//, '').replace(/[.,;:]+$/, '')
    if (!p || /^[a-z]+:\/\//i.test(p) || p.startsWith('.workbench/') || p.startsWith('/') || p.includes('..')) return
    if (/\.[A-Za-z0-9]{1,8}$/.test(p) || p.endsWith('/')) out.push(p)
  }
  const rest = text.replace(/`([^`]+)`/g, (_m, inner: string) => { push(inner); return ' ' }).replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
  for (const m of rest.matchAll(/(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*(?:\.[A-Za-z0-9]{1,8}|\/)(?![\w/*])/g)) push(m[0])
  return out
}

/** Which expected outputs are missing. A file must exist and be non-empty; a folder must hold a file. */
export function missingOutputs(outputs: string[], probe: (rel: string) => { kind: 'file' | 'dir' | 'none'; size: number; hasFiles?: boolean }): string[] {
  return outputs.filter((p) => {
    const s = probe(p.replace(/\/$/, ''))
    if (p.endsWith('/')) return !(s.kind === 'dir' && s.hasFiles)
    return !(s.kind === 'file' && s.size > 0)
  })
}

const FILE_BLOCK_START = '=== FILE: '
const FILE_BLOCK_END = '=== END FILE ==='

/** Instructions for a Maker that can only reply with text. */
export function textMakerInstructions(files: string[]): string {
  return [
    'You cannot write files in this run — Troupe saves them for you from your reply.',
    `Put the full content of each deliverable in your reply, each in its own block exactly like this (the path on the first line, the end marker on its own line):`,
    '',
    `${FILE_BLOCK_START}${files[0] ?? 'path/to/file.md'} ===`,
    '…full file content…',
    FILE_BLOCK_END,
    '',
    files.length ? `Files to deliver: ${files.map((f) => `\`${f}\``).join(', ')}.` : ''
  ].filter((l) => l !== null).join('\n')
}

/** Drop a trailing fenced json block (the handoff) from a reply. */
function stripTrailingJson(text: string): string {
  return text.replace(/```json\s*[\s\S]*?```\s*$/i, '').trimEnd()
}

/**
 * Files to save from a text-only Maker's reply, limited to the task's missing outputs.
 * Uses `=== FILE: path ===` blocks; with exactly one missing file and no blocks, the whole
 * reply (minus the handoff json) is that file.
 */
export function filesFromReply(reply: string, missing: string[]): { path: string; content: string }[] {
  const wanted = missing.filter((p) => !p.endsWith('/'))
  const norm = (p: string) => p.trim().replace(/^\.\//, '').replace(/^`|`$/g, '')
  const out: { path: string; content: string }[] = []
  const re = /^=== FILE: (.+?) ===[ \t]*\r?\n([\s\S]*?)\r?\n=== END FILE ===[ \t]*$/gm
  for (const m of reply.matchAll(re)) {
    const given = norm(m[1])
    const hit = wanted.find((w) => w === given || w.endsWith('/' + given) || given.endsWith('/' + w))
    if (hit && !out.some((o) => o.path === hit)) out.push({ path: hit, content: m[2].endsWith('\n') ? m[2] : m[2] + '\n' })
  }
  if (out.length === 0 && wanted.length === 1 && !reply.includes(FILE_BLOCK_START)) {
    const body = stripTrailingJson(reply).trim()
    if (body.length > 0) out.push({ path: wanted[0], content: body + '\n' })
  }
  return out
}
