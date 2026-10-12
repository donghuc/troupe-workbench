import type { ProviderId } from '../../shared/types'
import { parseAgentMentions } from '../../shared/mentions'
import { PROVIDER_IDS } from '../../shared/providers'
import type { ModeId } from '../../shared/modes'

// The pure part of turn orchestration (D-061): what a message means in terms of
// runs. No IPC, no DB, so it is unit-tested directly.

export interface TurnPlan {
  mode: 'sequential' | 'parallel'
  chain: ProviderId[]
  prompt: string     // what the agents are asked (mentions stripped)
  blocked?: ProviderId[]   // agents this message asks for that are turned off (D-071) — the turn is refused
  thinking?: ModeId        // @debate / @critique / @research (D-083): the template decides the chain
}

// `enabled`: agents switched on in Settings ▸ Agents. @all fans out to those only; naming
// (or defaulting to) an agent that is off blocks the turn rather than silently rerouting it.
export function planTurn(text: string, defaultProvider: ProviderId, enabled: ProviderId[] = PROVIDER_IDS): TurnPlan {
  const { targets, cleaned, parallel, thinking } = parseAgentMentions(text)
  const on = new Set(enabled)
  const wanted = parallel ? targets.filter((t) => on.has(t)) : (targets.length ? targets : [defaultProvider])
  const blocked = parallel ? [] : wanted.filter((t) => !on.has(t))
  const chain = wanted.length ? wanted : [enabled[0] ?? defaultProvider]
  const prompt = cleaned.trim() ? cleaned : text
  const mode: TurnPlan['mode'] = parallel && chain.length > 1 ? 'parallel' : 'sequential'
  const base: TurnPlan = { mode, chain, prompt, ...(thinking ? { thinking } : {}) }
  return blocked.length ? { ...base, blocked } : base
}
