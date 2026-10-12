import type { Skill } from '../../shared/types'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function parseTriggers(raw: string): string[] {
  return (raw || '').split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean)
}

// Pick the skill whose trigger keywords best match the prompt. Single-word
// keywords match on word boundaries (so "art" doesn't match "start"); multi-word
// phrases match as substrings. Returns the skill id with the most hits, or null.
export function matchSkill(text: string, skills: Skill[]): string | null {
  const t = text.toLowerCase()
  if (!t.trim()) return null
  let best: { id: string; hits: number } | null = null
  for (const s of skills) {
    const kws = parseTriggers(s.triggers)
    if (!kws.length) continue
    let hits = 0
    for (const kw of kws) {
      const hit = kw.includes(' ') ? t.includes(kw) : new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(t)
      if (hit) hits++
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { id: s.id, hits }
  }
  return best?.id ?? null
}
