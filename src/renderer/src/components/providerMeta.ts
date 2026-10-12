import type { ProviderId } from '../../../shared/types'
import { PROVIDERS } from '../../../shared/providers'
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

const providerMeta: Record<ProviderId, ProviderMeta> = {
  'claude-code': { name: PROVIDERS['claude-code'].label, mention: PROVIDERS['claude-code'].handle, mono: 'C', color: '#C96442', fg: '#ffffff', logo: claudeLogo },
  'codex': { name: PROVIDERS.codex.label, mention: PROVIDERS.codex.handle, mono: 'Cx', color: '#0d0d0d', fg: '#ffffff', logo: codexLogo },
  'grok': { name: PROVIDERS.grok.label, mention: PROVIDERS.grok.handle, mono: 'G', color: '#000000', fg: '#ffffff', logo: grokLogo },
  'gemini': { name: PROVIDERS.gemini.label, mention: PROVIDERS.gemini.handle, mono: 'Ge', color: '#1480FF', fg: '#ffffff', logo: geminiLogo }
}

export const metaFor = (id: ProviderId | null): ProviderMeta =>
  (id && providerMeta[id]) || { name: 'Assistant', mention: 'assistant', mono: 'A', color: '#7d7868', fg: '#ffffff' }
