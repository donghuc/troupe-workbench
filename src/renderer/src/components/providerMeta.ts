import type { ProviderId, BuiltinProviderId } from '../../../shared/types'
import { agentEntry, isBuiltinId } from '../../../shared/providers'
import claudeLogo from '../assets/providers/claude.jpg'
import codexLogo from '../assets/providers/codex.jpg'
import grokLogo from '../assets/providers/grok.png'
import geminiLogo from '../assets/providers/gemini.png'

// Official logo images are user-provided assets in src/renderer/src/assets/providers/.
// The monogram fallback renders if a logo is missing or fails to load.
export interface ProviderMeta {
  name: string
  mention: string
  mono: string
  color: string
  fg: string
  logo?: string
}

const providerMeta: Record<BuiltinProviderId, ProviderMeta> = {
  'claude-code': { name: agentEntry('claude-code').label, mention: agentEntry('claude-code').handle, mono: 'C', color: 'var(--brand-claude)', fg: 'var(--on-avatar)', logo: claudeLogo },
  'codex': { name: agentEntry('codex').label, mention: agentEntry('codex').handle, mono: 'Cx', color: 'var(--brand-codex)', fg: 'var(--on-avatar)', logo: codexLogo },
  'grok': { name: agentEntry('grok').label, mention: agentEntry('grok').handle, mono: 'G', color: 'var(--brand-grok)', fg: 'var(--on-avatar)', logo: grokLogo },
  'gemini': { name: agentEntry('gemini').label, mention: agentEntry('gemini').handle, mono: 'Ge', color: 'var(--brand-gemini)', fg: 'var(--on-avatar)', logo: geminiLogo }
}

// User-added agents (2.4) get a monogram tile: up to two letters of the name on a colour
// picked from the id, so the same agent always looks the same.
const CUSTOM_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--avatar-${n})`)   // tokens.css
function monogram(label: string): string {
  const words = label.trim().split(/[\s_-]+/).filter(Boolean)
  const m = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()
}
function customMeta(id: ProviderId): ProviderMeta {
  const e = agentEntry(id)
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { name: e.label, mention: e.handle, mono: monogram(e.label), color: CUSTOM_COLORS[h % CUSTOM_COLORS.length], fg: 'var(--on-avatar)' }
}

export const metaFor = (id: ProviderId | null): ProviderMeta =>
  (id && isBuiltinId(id) && providerMeta[id]) || (id ? customMeta(id) : { name: 'Assistant', mention: 'assistant', mono: 'A', color: 'var(--avatar-fallback)', fg: 'var(--on-avatar)' })
