import { useSyncExternalStore } from 'react'
import { api } from './api'
import { EMPTY_QUEUE, type QueueState } from '../../shared/turnQueue'
import { reportError } from './notices'

// Renderer mirror of main's message queues (D-138): what waits to run in each chat.
const queues = new Map<string, QueueState>()
const empties = new Map<string, QueueState>()
const listeners = new Set<() => void>()
const loaded = new Set<string>()
let wired = false

export function applyQueue(q: QueueState): void {
  queues.set(q.conversationId, q)
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  if (!wired) { wired = true; api.queue.onChanged(applyQueue) }
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function snapshot(id: string): QueueState {
  if (!loaded.has(id)) {
    loaded.add(id)
    api.queue.get(id).then(applyQueue).catch((e: unknown) => reportError('Load queued messages', e, { silent: true }))
  }
  const q = queues.get(id); if (q) return q
  let e = empties.get(id); if (!e) { e = EMPTY_QUEUE(id); empties.set(id, e) }
  return e
}

export function useQueue(convId: string): QueueState { return useSyncExternalStore(subscribe, () => snapshot(convId)) }
