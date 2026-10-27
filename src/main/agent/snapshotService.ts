import { app, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import { getConversation } from '../conversations/conversationsRepo'
import { countMessages, listMessagesFrom } from '../conversations/messagesRepo'
import { getLatestSnapshot, insertSnapshot } from '../conversations/snapshotRepo'
import { getNumberSetting } from '../database/settingsRepo'
import { createProvider } from '../providers/registry'
import { formatTranscript, COMPRESS_TRANSCRIPT } from './handoff'
import { agentTraits } from '../../shared/providers'

const SUMMARY_INSTRUCTIONS =
  'You are compressing a conversation into a compact, provider-independent session state. ' +
  'Output ONLY these sections (omit any that are empty):\n' +
  '## Goal\n## Decisions\n## Current Direction\n## Open Questions\n## Relevant Files\n## Current Task\n' +
  'Be terse — bullet points, no preamble.'

let running = new Set<string>()

// Should we compress? True when enough new turns have accrued since the last snapshot.
function shouldCompress(conversationId: string): boolean {
  const prev = getLatestSnapshot(conversationId)
  const since = countMessages(conversationId) - (prev?.throughCount ?? 0)
  const threshold = getNumberSetting('compaction_threshold', 20) // spec §37 fallback; lowered 30→20 (token opt 2026-09-14)
  return since >= threshold
}

// Generate + store a snapshot. Failure-safe: on any error, keep the previous
// snapshot and recent messages (spec §36/§37). Visible via IPC status.
export async function maybeCompress(conversationId: string, sender: WebContents, force = false): Promise<void> {
  if (running.has(conversationId) || (!force && !shouldCompress(conversationId))) return
  running.add(conversationId)
  const conv = getConversation(conversationId)
  if (!conv) { running.delete(conversationId); return }
  const notify = (state: 'start' | 'end') => { if (!sender.isDestroyed()) sender.send(IPC.convCompressing, { conversationId, state }) }
  try {
    notify('start')
    const prev = getLatestSnapshot(conversationId)
    const from = prev?.throughCount ?? 0
    const windowMsgs = listMessagesFrom(conversationId, from)
    if (windowMsgs.length === 0) { running.delete(conversationId); notify('end'); return }

    const provider = createProvider(conv.provider)
    if (!provider) { running.delete(conversationId); notify('end'); return }
    const model = agentTraits(conv.provider).fastModel || undefined   // audit #16: was 'haiku' for Claude by name
    const prompt = [
      SUMMARY_INSTRUCTIONS,
      prev ? `\nPrevious summary:\n${prev.content}` : '',
      `\nNew conversation turns to fold in:\n${formatTranscript(windowMsgs, COMPRESS_TRANSCRIPT)}`
    ].join('\n')

    let text = ''
    for await (const ev of provider.run({ prompt, context: {}, cwd: app.getPath('temp'), model }, undefined)) {
      if (ev.type === 'text_delta') text += ev.text
      else if (ev.type === 'error' && ev.fatal) throw new Error(ev.message)
    }
    if (text.trim()) insertSnapshot(conversationId, text.trim(), from + windowMsgs.length, conv.provider)
  } catch {
    /* failure-safe: keep previous snapshot + recent messages, retry next trigger */
  } finally {
    running.delete(conversationId)
    if (!sender.isDestroyed()) sender.send(IPC.convCompressing, { conversationId, state: 'end' })
  }
}
