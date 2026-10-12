// Thinking modes (D-080 item 4, D-083): Debate, Critique, Research. A mode turns one
// message into a fixed sequence of steps — each step an agent playing a role with a
// short instruction — followed by a Compare card. Casts live in a template (Settings ▸
// Thinking), never asked per run (Hien: option A). Pure; tested.
import type { ProviderId } from './types'
import { PROVIDERS, isProviderId, enabledProviderIds } from './providers'

export type ModeId = 'debate' | 'critique' | 'research'
export const MODE_IDS: ModeId[] = ['debate', 'critique', 'research']
export const MODES_SETTING = 'thinking_modes'

export interface ModeRole { key: string; label: string; hint: string }
export interface ModeDef { id: ModeId; label: string; description: string; roles: ModeRole[]; rounds: { min: number; max: number; default: number } | null; skill: string }

export const MODES: Record<ModeId, ModeDef> = {
  debate: {
    id: 'debate', label: 'Debate', description: 'Two agents argue for and against, a third judges.',
    roles: [{ key: 'for', label: 'For', hint: 'Argues the proposition' }, { key: 'against', label: 'Against', hint: 'Argues against it' }, { key: 'judge', label: 'Judge', hint: 'Weighs both sides and rules' }],
    rounds: { min: 1, max: 3, default: 2 }, skill: 'mode-debate'
  },
  critique: {
    id: 'critique', label: 'Critique', description: 'One agent produces, another attacks it, the first responds.',
    roles: [{ key: 'produce', label: 'Produce', hint: 'Drafts the answer or artefact' }, { key: 'attack', label: 'Attack', hint: 'Finds what is wrong or weak' }],
    rounds: null, skill: 'mode-critique'
  },
  research: {
    id: 'research', label: 'Research', description: 'One agent gathers sources, another checks them.',
    roles: [{ key: 'gather', label: 'Gather', hint: 'Searches and reads sources' }, { key: 'check', label: 'Check', hint: 'Verifies claims against the sources' }],
    rounds: null, skill: 'mode-research'
  }
}

export interface ModeTemplate { roles: Record<string, ProviderId>; rounds?: number }
export type ModeTemplates = Record<ModeId, ModeTemplate>

export const DEFAULT_TEMPLATES: ModeTemplates = {
  debate: { roles: { for: 'claude-code', against: 'codex', judge: 'gemini' }, rounds: 2 },
  critique: { roles: { produce: 'claude-code', attack: 'codex' } },
  research: { roles: { gather: 'gemini', check: 'claude-code' } }
}

export function parseModeTemplates(raw: string | null | undefined): ModeTemplates {
  const out: ModeTemplates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES))
  if (!raw) return out
  try {
    const v = JSON.parse(raw) as Partial<Record<ModeId, Partial<ModeTemplate>>>
    for (const id of MODE_IDS) {
      const t = v?.[id]; if (!t) continue
      for (const r of MODES[id].roles) { const a = t.roles?.[r.key]; if (isProviderId(a)) out[id].roles[r.key] = a }
      const rr = MODES[id].rounds
      if (rr && typeof t.rounds === 'number') out[id].rounds = Math.min(rr.max, Math.max(rr.min, Math.round(t.rounds)))
    }
  } catch { /* keep defaults */ }
  return out
}

export interface ModeStep { provider: ProviderId; role: string; instruction: string; fallback?: boolean }

/** A role's agent, or the first agent that is on when it isn't available (never blocks). */
export function castFor(mode: ModeId, template: ModeTemplate, disabledRaw: string | null | undefined): { cast: Record<string, ProviderId>; fallbacks: string[] } {
  const on = enabledProviderIds(disabledRaw)
  const cast: Record<string, ProviderId> = {}; const fallbacks: string[] = []
  for (const r of MODES[mode].roles) {
    const want = template.roles[r.key]
    if (want && on.includes(want)) cast[r.key] = want
    else { cast[r.key] = on[0]; fallbacks.push(r.key) }
  }
  return { cast, fallbacks }
}

/** The steps a mode runs for one message, in order. `topic` is the user's message. */
export function buildModeSteps(mode: ModeId, template: ModeTemplate, disabledRaw: string | null | undefined): ModeStep[] {
  const { cast, fallbacks } = castFor(mode, template, disabledRaw)
  const fb = (role: string) => fallbacks.includes(role)
  const name = (role: string) => PROVIDERS[cast[role]].label
  const steps: ModeStep[] = []
  if (mode === 'debate') {
    const rounds = template.rounds ?? MODES.debate.rounds!.default
    for (let r = 1; r <= rounds; r++) {
      steps.push({ provider: cast.for, role: 'for', fallback: fb('for'), instruction: `Debate, round ${r} of ${rounds}. You argue FOR the proposition. ${r === 1 ? 'Open with your strongest case: at most three arguments, each with its evidence.' : `Rebut ${name('against')}'s last points directly, then add anything new. Concede what you must.`} Keep it under 200 words.` })
      steps.push({ provider: cast.against, role: 'against', fallback: fb('against'), instruction: `Debate, round ${r} of ${rounds}. You argue AGAINST the proposition. ${r === 1 ? `Answer ${name('for')}'s opening point by point, then give your strongest counter-case.` : `Rebut ${name('for')}'s last points directly, then add anything new. Concede what you must.`} Keep it under 200 words.` })
    }
    steps.push({ provider: cast.judge, role: 'judge', fallback: fb('judge'), instruction: `You are the judge. The debate above is over. Rule on the proposition: which side made the stronger case and why, in one paragraph; then list the points that actually decided it, and what evidence would change your ruling. Do not add new arguments of your own. Under 200 words.` })
  } else if (mode === 'critique') {
    steps.push({ provider: cast.produce, role: 'produce', fallback: fb('produce'), instruction: 'Critique, step 1 of 3 — PRODUCE. Give your best answer to the request. Be concrete and complete enough to be attacked; state your assumptions.' })
    steps.push({ provider: cast.attack, role: 'attack', fallback: fb('attack'), instruction: `Critique, step 2 of 3 — ATTACK. Find what is wrong, weak, missing or risky in ${name('produce')}'s answer above. Rank the problems by how much they matter, most important first, with a one-line reason each. No praise, no rewrite — findings only. At most six.` })
    steps.push({ provider: cast.produce, role: 'produce', fallback: fb('produce'), instruction: `Critique, step 3 of 3 — RESPOND. Take ${name('attack')}'s findings in order: for each, either fix it (show the change) or explain in one line why it stands. Then give the revised answer.` })
  } else {
    steps.push({ provider: cast.gather, role: 'gather', fallback: fb('gather'), instruction: 'Research, step 1 of 2 — GATHER. Search the web and read the sources that answer the request. Report: the conclusion first (two or three lines), then the key findings, each with the source it comes from (title and link). Note where sources disagree. Prefer primary sources and recent dates.' })
    steps.push({ provider: cast.check, role: 'check', fallback: fb('check'), instruction: `Research, step 2 of 2 — CHECK. Verify ${name('gather')}'s report above: for each key finding, does the cited source actually support it? Open the sources where you can. Mark each finding Supported / Not supported / Could not check, with a one-line note, then restate the conclusion as it stands after checking.` })
  }
  return steps
}

/** One-line description of a run for the header, e.g. "Debate · For: Claude · Against: Codex · Judge: Gemini · 2 rounds". */
export function describeCast(mode: ModeId, template: ModeTemplate, disabledRaw: string | null | undefined): string {
  const { cast, fallbacks } = castFor(mode, template, disabledRaw)
  const parts = MODES[mode].roles.map((r) => `${r.label}: ${PROVIDERS[cast[r.key]].label}${fallbacks.includes(r.key) ? ' (fallback)' : ''}`)
  const rounds = MODES[mode].rounds ? ` · ${template.rounds ?? MODES[mode].rounds!.default} rounds` : ''
  return `${MODES[mode].label} · ${parts.join(' · ')}${rounds}`
}
