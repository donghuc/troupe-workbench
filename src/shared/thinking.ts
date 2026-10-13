// Thinking settings and the Compare prompt (D-080 items 1–2, D-081). Pure; tested.
import type { ProviderId } from './types'
import { agentEntry, isProviderId, enabledProviderIds } from './providers'

export const THINKING_AGENT_SETTING = 'thinking_agent'   // provider id; default Claude
export const THINKING_MODEL_SETTING = 'thinking_model'   // '' = that agent's default
export const COMPARE_AUTO_SETTING = 'compare_auto'       // '0' turns off the automatic card after @all

/** The agent that drafts outcomes and writes Compare cards. Falls back when it's off:
 *  first to the chat's current agent, then to the first agent that is on. */
export function resolveThinkingAgent(setting: string | null | undefined, disabledRaw: string | null | undefined, chatAgent?: ProviderId | null): ProviderId {
  const on = enabledProviderIds(disabledRaw)
  const want = isProviderId(setting) ? setting : 'claude-code'
  if (on.includes(want)) return want
  if (chatAgent && on.includes(chatAgent)) return chatAgent
  return on[0]
}

export interface CompareInput { question: string; replies: { provider: ProviderId; text: string }[] }

// Kept short on purpose (D-080 principle: Troupe reads, Hien decides). Fixed headings so
// the card renders predictably; sections without content are left out.
export function buildComparePrompt(input: CompareInput): string {
  const replies = input.replies.map((r, i) => `### Reply ${i + 1} — ${agentEntry(r.provider).label}\n\n${r.text.trim() || '(no reply)'}`).join('\n\n')
  return [
    'You are comparing several AI agents\' independent answers to the same question, for a reader who wants to decide quickly. Write a compact comparison card in Markdown, under 160 words, no preamble, no closing remarks.',
    '',
    'First line — pick ONE form from the question type:',
    '- A choice ("should I…", "which…", "A or B"): `**Verdict:** <one sentence> — <N> of <M> say <X>.`',
    '- Open exploration ("ideas for…", "what do you think of…"): `**Angles:** <one sentence naming the distinct angles taken>.`',
    '- A factual question: `**Answer:** <one sentence>` — if the agents disagree on the facts, say so here.',
    'Write the first line as a plain statement: no "my read", "in my view", "based on the replies" or similar framing — the card header already says who wrote it.',
    '',
    'Then these sections as bold labels on their own lines, each with 1–3 short bullets; omit a section that has nothing:',
    '`**Agree**` — points most or all agents share.',
    '`**Disagree**` — name the agent and give its reason in a few words (e.g. "Grok: stay home — wet gear outweighs the fun").',
    '`**Only one raised**` — a point a single agent made that changes the picture; name the agent.',
    '`**Open**` — what would settle it (missing facts, a test to run).',
    '',
    'Rules: name agents by the labels below; do not invent claims; do not repeat the replies; prefer concrete over general; no headings other than the bold labels.',
    '',
    `## Question\n\n${input.question.trim()}`,
    '',
    `## Replies\n\n${replies}`
  ].join('\n')
}
