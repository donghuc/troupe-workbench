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

export type QueuePause = 'stopped' | 'error' | 'restart'

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

export type TurnOutcome = 'done' | 'stopped' | 'error'

/** After a turn: run the next message, or pause after Stop or a failure. */
export function afterTurn(q: QueueState, outcome: TurnOutcome): { queue: QueueState; runNext: boolean } {
  if (!q.items.length) return { queue: q.paused ? { ...q, paused: null, error: undefined } : q, runNext: false }
  if (outcome !== 'done') return { queue: { ...q, paused: outcome }, runNext: false }
  return { queue: q, runNext: !q.paused }
}

/** A message sent now: start it at once only when the chat is free and nothing is waiting to run. */
export function startsNow(q: QueueState, busy: boolean): boolean {
  return !busy && (q.items.length === 0 || q.paused !== null)
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
