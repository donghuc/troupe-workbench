// Messages sent while a chat is busy wait in a queue and run one by one, each as its own
// turn, as soon as the turn before it finishes (D-138). A stopped or failed turn pauses
// the queue instead of carrying on. Pure rules here; main/agent/turnQueue.ts runs them.
import type { StartTurnInput } from './turns'

export interface QueuedMessage {
  id: string
  /** What the list shows (the typed text, without folded-in selections). */
  text: string
  input: StartTurnInput
  queuedAt: number
}

export type QueuePause = 'stopped' | 'error' | 'restart' | 'collab'

export interface QueueState {
  conversationId: string
  items: QueuedMessage[]
  /** Why the queue is waiting for Resume; null = it runs as soon as the chat is free. */
  paused: QueuePause | null
  error?: string
}

export const TURN_QUEUE_SETTING = 'turn_queue'
export const QUEUE_MAX = 20

export const EMPTY_QUEUE = (conversationId: string): QueueState => ({ conversationId, items: [], paused: null })

/** The text a queued message shows: the typed words, not the selections folded into the prompt. */
export function queuedText(input: StartTurnInput): string {
  const shown = input.messageMetadata?.displayText
  return (typeof shown === 'string' && shown.trim() ? shown : input.text).trim()
}

/** How the work holding a chat ended. 'waiting': a Collab run paused for you (plan to approve,
 *  needs attention) — it isn't over, so queued messages wait for it. */
export type TurnOutcome = 'done' | 'stopped' | 'error' | 'waiting'

/** After a turn: run the next message, or pause after Stop or a failure. */
export function afterTurn(q: QueueState, outcome: TurnOutcome): { queue: QueueState; runNext: boolean } {
  if (!q.items.length) return { queue: q.paused ? { ...q, paused: null, error: undefined } : q, runNext: false }
  if (outcome === 'waiting') return { queue: q.paused ? q : { ...q, paused: 'collab' }, runNext: false }
  if (outcome !== 'done') return { queue: { ...q, paused: outcome }, runNext: false }
  // A Collab run that held the queue finished: carry on. A pause you caused (Stop) stays.
  if (q.paused === 'collab') return { queue: { ...q, paused: null, error: undefined }, runNext: true }
  return { queue: q, runNext: !q.paused }
}

/** A message sent now: start it at once only when the chat is free, nothing is waiting to run,
 *  and no Collab run in this chat is waiting for you (plan to approve, paused) — D-139 fix: the
 *  chat is free then, but a message would take it before Approve / Resume. */
export function startsNow(q: QueueState, busy: boolean, collabWaiting = false): boolean {
  return !busy && !collabWaiting && (q.items.length === 0 || q.paused !== null)
}

/** Restore saved queues after a restart: they wait for Resume. Drops empty ones and unknown chats. */
export function parseSavedQueues(raw: string | null, exists: (conversationId: string) => boolean): QueueState[] {
  let v: unknown
  try { v = JSON.parse(raw ?? '[]') } catch { return [] }
  if (!Array.isArray(v)) return []
  const out: QueueState[] = []
  for (const q of v as QueueState[]) {
    if (!q || typeof q.conversationId !== 'string' || !Array.isArray(q.items) || !exists(q.conversationId)) continue
    const items = q.items.filter((i) => i && typeof i.id === 'string' && i.input && typeof i.input.text === 'string' && i.input.conversationId === q.conversationId)
    if (items.length) out.push({ conversationId: q.conversationId, items, paused: 'restart' })
  }
  return out
}

/** What is saved for a restart (audit #18): attachments by path only. A file's inline text (a text
 *  file, a PDF's extracted text) isn't written into settings; after a restart the agent is told to
 *  open the file itself, like a document. */
export function queuesForDisk(qs: QueueState[]): QueueState[] {
  return qs.filter((q) => q.items.length).map((q) => ({
    ...q,
    items: q.items.map((it) => it.input.attachments?.some((a) => a.content !== undefined)
      ? { ...it, input: { ...it.input, attachments: it.input.attachments.map(({ content, ...a }) => (content !== undefined && !a.image ? { ...a, doc: true } : a)) } }
      : it)
  }))
}
