import { app } from 'electron'
import { createProvider } from '../providers/registry'
import { getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { listMessages } from '../conversations/messagesRepo'
import { getSetting } from '../database/settingsRepo'
import { resolveProjectMemory } from './projectMemory'
import { listOutcomes } from './decisionsRepo'
import { formatTranscript } from '../agent/handoff'
import { resolveThinkingAgent, THINKING_AGENT_SETTING, THINKING_MODEL_SETTING } from '../../shared/thinking'
import { DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { modelForProvider, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { modelLists } from '../tools/codexModels'
import { buildOutcomePrompt, parseOutcomeDraft, today, type Outcome } from '../../shared/decisions'
import { logInfo, logWarn } from '../util/logger'

// Save outcome, drafting half (D-081 step 6). The drafting agent (Settings ▸ Thinking)
// reads the exchange that led to `messageId` — from the last user message before it up
// to and including it — plus the project's facts and the log index, and returns a
// filled-in record for Hien to glance at and save. Runs like compression: a direct
// provider run, nothing appended to the conversation.
export async function draftOutcome(conversationId: string, messageId?: string): Promise<Outcome> {
  const conv = getConversation(conversationId)
  const project = conv ? getProject(conv.projectId) : null
  if (!conv || !project) throw new Error('Conversation not found')
  const all = listMessages(conversationId)
  let end = messageId ? all.findIndex((m) => m.id === messageId) : all.length - 1
  if (end < 0) end = all.length - 1
  let start = end
  while (start > 0 && all[start].role !== 'user') start--
  const slice = all.slice(Math.max(0, start), end + 1)
  if (!slice.length) throw new Error('Nothing to capture yet')
  const existing = listOutcomes(project)
  const prompt = buildOutcomePrompt({
    transcript: formatTranscript(slice, { maxTurns: 40, recentFull: slice.length, oldCap: 4000, recentCap: 6000 }),
    memory: resolveProjectMemory(project) ?? '',
    existing,
    chatTitle: conv.title
  })
  const agent = resolveThinkingAgent(getSetting(THINKING_AGENT_SETTING), getSetting(DISABLED_AGENTS_SETTING), conv.provider)
  const model = modelForProvider(agent, getSetting(THINKING_MODEL_SETTING) || undefined, modelLists(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))) || undefined
  const provider = createProvider(agent)
  if (!provider) throw new Error('No drafting agent available')
  logInfo('outcome draft start', { conv: conversationId, agent, turns: slice.length })
  let text = ''
  for await (const ev of provider.run({ prompt, context: {}, cwd: app.getPath('temp'), model, permissionMode: 'read' }, undefined)) {
    if (ev.type === 'text_delta') text += ev.text
    else if (ev.type === 'error' && ev.fatal) throw new Error(ev.message)
  }
  const d = parseOutcomeDraft(text)
  if (!d || !d.title) { logWarn('outcome draft unparseable', { conv: conversationId, head: text.slice(0, 200) }); throw new Error('The drafting agent did not return a usable record. Try again.') }
  return { id: '', date: today(), kind: d.kind ?? 'decision', title: d.title, why: d.why, considered: d.considered, open: d.open, conflicts: d.conflicts, source: conv.title }
}
