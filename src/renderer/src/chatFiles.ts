import type { Message } from '../../shared/types'
import { IS_WINDOWS, isAbsPath, relUnder } from '../../shared/platform'
import type { AgentAction } from '../../shared/agent'
import type { IconName } from './components/Icon'
import { normalizeRel } from './links'
import { linkTargets } from '../../shared/fileCards'
import { selectionsFromMeta } from '../../shared/selections'

// D-098: the chat's pure helpers, moved out of ConversationView so they can be tested
// and shared with MessageRow / ChatSidePanel. Behaviour unchanged.

/** File types the artifact viewer can open. */
export const ARTIFACT_EXT = /\.(md|markdown|html?|txt|csv|tsv|json|pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp4|webm|mov|m4v|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i

const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4))
interface Usage { inputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; outputTokens?: number; costUsd?: number }
const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString())

export const usageMain = (m: { role: string; content: string; metadata: Record<string, unknown> | null }): string => {
  const u = (m.metadata?.usage ?? null) as Usage | null
  if (m.role === 'assistant' && u && (u.inputTokens || u.cacheReadTokens || u.cacheCreationTokens || u.outputTokens)) {
    const totalIn = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0)
    const parts: string[] = []
    if (totalIn) parts.push(`${fmt(totalIn)} in`)
    if (u.cacheReadTokens) parts.push(`${fmt(u.cacheReadTokens)} cached`)   // D-075: cached input costs ~1/10
    if (u.outputTokens) parts.push(`${fmt(u.outputTokens)} out`)
    if (u.costUsd) parts.push(`$${u.costUsd.toFixed(4)}`)
    const mu = m.metadata?.modelUsed
    if (typeof mu === 'string' && mu) parts.push(mu)   // the model the CLI reported at session start (ground truth)
    return parts.join(' · ')
  }
  // No usage reported (user-added agents): still say which model answered.
  const mu = m.role === 'assistant' ? m.metadata?.modelUsed : undefined
  return `~${approxTokens(m.content).toLocaleString()} tokens${typeof mu === 'string' && mu ? ` · ${mu}` : ''}`
}

export const usageBreakdown = (m: { role: string; metadata: Record<string, unknown> | null }): string | null => {
  const u = (m.metadata?.usage ?? null) as Usage | null
  if (m.role !== 'assistant' || !u) return null
  const bits: string[] = []
  if (u.inputTokens) bits.push(`${fmt(u.inputTokens)} new`)
  if (u.cacheReadTokens) bits.push(`${fmt(u.cacheReadTokens)} cache-read`)
  if (u.cacheCreationTokens) bits.push(`${fmt(u.cacheCreationTokens)} cache-write`)
  return bits.length > 1 ? bits.join(' · ') : null
}
export const actionsOf = (metadata: Record<string, unknown> | null): AgentAction[] => {
  const a = metadata?.actions
  return Array.isArray(a) ? (a as AgentAction[]) : []
}
export const attachmentsMeta = (metadata: Record<string, unknown> | null): { name: string; image: boolean; path?: string; viewable?: boolean }[] => {
  const a = metadata?.attachments
  return Array.isArray(a) ? (a as { name: string; image: boolean; path?: string; viewable?: boolean }[]) : []
}

export const artifactIcon = (rel: string): IconName => (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(rel) ? 'image' : /\.html?$/i.test(rel) ? 'globe' : 'file')
export const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i
// Files worth surfacing as artifacts when an agent writes them, linked or not.
const DELIVERABLE_EXT = /\.(html?|md|pdf|png|jpe?g|gif|webp|svg|avif|docx?|pptx?|xlsx?|csv)$/i
const WRITE_TOOL = /^(write|edit|multiedit|notebookedit|write_file|edit_file|create_file|apply_patch|str_replace_editor|replace)$/i
export const wbfileSrc = (root: string, rel: string) => `wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`

/** Project-relative form of an absolute-inside-cwd or ./-prefixed path. */
export const toRelPath = (cwd: string | undefined, p: string): string => {
  let r = p.replace(IS_WINDOWS ? /^\.[\\/]/ : /^\.\//, '')
  const u = cwd ? relUnder(r, cwd) : null
  if (u !== null) r = u
  return IS_WINDOWS && !isAbsPath(r) ? r.replace(/\\/g, '/') : r
}

/**
 * Files referenced in a chat, newest first: `linked` = artifacts (linked in a reply, or a
 * deliverable-type file the agent wrote), `touched` = other files it worked on.
 */
export function collectChatFiles(messages: Message[], cwd: string | undefined): { linked: string[]; touched: string[] } {
  const toRel = (p: string) => toRelPath(cwd, p)
  const seen = new Set<string>(); const linked: string[] = []; const written: string[] = []; const touched: string[] = []
  const clean = (raw: string | undefined): string | null => {
    if (!raw) return null
    const rel = toRel(raw)
    if (isAbsPath(rel) || /^[a-z]+:\/\//i.test(rel)) return null  // outside the folder / a URL — can't open
    if (rel.split('/').some((seg) => seg.startsWith('.'))) return null   // hidden file or folder
    return ARTIFACT_EXT.test(rel) ? rel : null
  }
  const push = (raw: string | undefined, into: string[]) => { const rel = clean(raw); if (rel && !seen.has(rel)) { seen.add(rel); into.push(rel) } }
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const mt of messages[i].content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) push(normalizeRel(mt[1]), linked)  // file:// and :line links too (B-048)
  }
  // Writes: Codex/Gemini/Grok report file_changed (kind 'file'); Claude's writes are the
  // Write/Edit tools. A written deliverable is an artifact; other writes and all reads
  // stay working files.
  const wrote = (a: AgentAction) => a.kind === 'file' || WRITE_TOOL.test(a.label)
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const a of actionsOf(messages[i].metadata)) {
      const rel = clean(a.path)
      if (!rel) continue
      push(a.path, wrote(a) && DELIVERABLE_EXT.test(rel) ? written : touched)
    }
  }
  return { linked: [...linked, ...written].slice(0, 40), touched: touched.slice(0, 80) }
}

/** Files this reply created or edited (captured file_changed actions), openable as artifacts. */
export function fileArtifacts(metadata: Record<string, unknown> | null, cwd: string | undefined): string[] {
  const toRel = (p: string) => toRelPath(cwd, p)
  const seen = new Set<string>(); const out: string[] = []
  for (const a of actionsOf(metadata)) {
    if (a.kind !== 'file' || !a.path) continue
    const rel = toRel(a.path)
    if (isAbsPath(rel) || /^[a-z]+:\/\//i.test(rel)) continue
    if (ARTIFACT_EXT.test(rel) && !seen.has(rel)) { seen.add(rel); out.push(rel) }
  }
  return out
}

/**
 * File cards under a reply: files it linked, then files it created or edited. Hidden
 * files and files known to be gone (`checked` but not `existing`) are left out.
 */
export function replyFiles(m: Message, cwd: string | undefined, existing: Set<string> | null, checked: Set<string>): string[] {
  const toRel = (p: string) => toRelPath(cwd, p)
  const out: string[] = []
  const add = (raw: string) => {
    const rel = toRel(normalizeRel(raw))
    if (!rel || rel.startsWith('/') || /^[a-z]+:/i.test(rel) || !ARTIFACT_EXT.test(rel)) return
    if (rel.split('/').some((seg) => seg.startsWith('.'))) return
    if (existing && checked.has(rel) && !existing.has(rel)) return
    if (!out.includes(rel)) out.push(rel)
  }
  // Linked images already render inline as thumbnails in the text.
  for (const t of linkTargets(m.content)) if (!IMG_RE.test(normalizeRel(t))) add(t)
  for (const rel of fileArtifacts(m.metadata, cwd)) add(rel)
  return out.slice(0, 8)
}

/** A message sent with selected passages stores what the user typed separately (D-065). */
export function userDisplayText(m: Message): string {
  const d = (m.metadata as { displayText?: unknown } | null)?.displayText
  return typeof d === 'string' && selectionsFromMeta(m.metadata).length ? d : m.content
}
