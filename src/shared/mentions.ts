import type { ProviderId } from './types'
import { PROVIDERS, PROVIDER_IDS } from './providers'
import { MODE_IDS, type ModeId } from './modes'

// @mention routing, shared by main (turn orchestration, D-061) and the renderer
// (composer autocomplete). Handles are static so this file has no UI imports.
export interface AgentHandle { id: ProviderId; handle: string; name: string }

export const agentHandles: AgentHandle[] = PROVIDER_IDS.map((id) => ({ id, handle: PROVIDERS[id].handle, name: PROVIDERS[id].label }))

const handleToId = (h: string): ProviderId | null =>
  agentHandles.find((a) => a.handle === h.toLowerCase())?.id ?? null

// Parse leading @agent mentions off the front of a message. @all also counts anywhere in it.
// "@claude @codex review this" -> { targets: ['claude-code','codex'], cleaned: 'review this' }
// A leading token that isn't a known agent stops parsing and is treated as text.
export function parseAgentMentions(text: string): { targets: ProviderId[]; cleaned: string; parallel?: boolean; thinking?: ModeId } {
  let rest = text.replace(/^\s+/, '')
  // Thinking modes (D-083): @debate / @critique / @research anywhere in the message, like
  // @all. Stripped when leading; left in place mid-sentence. The rest of the text is the
  // proposition. A mode wins over agent mentions (its template picks the cast).
  for (const id of MODE_IDS) {
    const lead = rest.match(new RegExp(`^@${id}\\b[ \\t]*`, 'i'))
    if (lead) return { targets: [], cleaned: rest.slice(lead[0].length), thinking: id }
    if (new RegExp(`(^|[^\\w.@])@${id}(?![\\w@-])`, 'i').test(rest)) return { targets: [], cleaned: rest, thinking: id }
  }
  // @all → blind-parallel: every agent answers the same prompt independently.
  const allMatch = rest.match(/^@all\b[ \t]*/i)
  if (allMatch) {
    return { targets: agentHandles.map((a) => a.id), cleaned: rest.slice(allMatch[0].length), parallel: true }
  }
  // @all anywhere in the message works too ("Hello @all, how are you?"). It stays in the
  // text, where it reads naturally. Not inside a word or an address (x@all.com, @allowed).
  if (/(^|[^\w.@])@all(?![\w@-])/i.test(rest)) {
    return { targets: agentHandles.map((a) => a.id), cleaned: rest, parallel: true }
  }
  const targets: ProviderId[] = []
  const seen = new Set<ProviderId>()
  for (;;) {
    const m = rest.match(/^@(\w+)[ \t]*/)
    if (!m) break
    const id = handleToId(m[1])
    if (!id) break
    if (!seen.has(id)) { seen.add(id); targets.push(id) }
    rest = rest.slice(m[0].length)
  }
  if (targets.length === 0) return { targets: [], cleaned: text }
  return { targets, cleaned: rest }
}
