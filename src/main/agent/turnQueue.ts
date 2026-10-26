// The message queue (D-138): send while a chat is busy and the message waits here, then runs
// as its own turn when the chat is free. Main owns it, like the busy lock, so it survives a
// window reload and chat switches. It is saved in settings, so a quit doesn't lose it: after a
// restart a queue waits for Resume. Rules are in shared/turnQueue.ts.
import { randomUUID } from 'crypto'
import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import type { StartTurnInput, TurnState } from '../../shared/turns'
import { EMPTY_QUEUE, QUEUE_MAX, TURN_QUEUE_SETTING, afterTurn, parseSavedQueues, queuedText, startsNow, queuesForDisk, type QueueState } from '../../shared/turnQueue'
import { startTurn, isBusy, onTurnIdle } from './turns'
import { senderForRun } from './headless'
import { getConversation } from '../conversations/conversationsRepo'
import { getSetting, setSetting } from '../database/settingsRepo'
import { cleanErrorMessage } from '../../shared/errors'
import { logInfo, logWarn } from '../util/logger'

const queues = new Map<string, QueueState>()
// Chats whose Collab run let go of the chat to wait for you (outcome 'waiting'). Cleared by the
// next outcome there (the run resumed and ended, or was stopped). Memory only: after a restart a
// waiting plan doesn't hold the chat.
const collabWaiting = new Set<string>()

export const getQueue = (conversationId: string): QueueState => queues.get(conversationId) ?? EMPTY_QUEUE(conversationId)

function put(q: QueueState): void {
  if (q.items.length || q.paused) queues.set(q.conversationId, q); else queues.delete(q.conversationId)
  try { setSetting(TURN_QUEUE_SETTING, JSON.stringify(queuesForDisk([...queues.values()]))) } catch (e) { logWarn('queue save failed', { err: String(e) }) }
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(IPC.queueChanged, getQueue(q.conversationId)) }
}

const find = (conversationId: string, id: string) => {
  const q = getQueue(conversationId)
  const i = q.items.findIndex((x) => x.id === id)
  if (i < 0) throw new Error('That queued message has already run or was removed.')
  return { q, i }
}

/** Send from the app: start now if the chat is free, else queue it. */
export function sendOrQueue(sender: WebContents, input: StartTurnInput): { turn?: TurnState; queue: QueueState } {
  const q = getQueue(input.conversationId)
  if (!input.text.trim()) return { queue: q }
  const busy = isBusy(input.conversationId), waiting = collabWaiting.has(input.conversationId)
  if (startsNow(q, busy, waiting)) return { turn: startTurn(sender, input), queue: q }
  if (q.items.length >= QUEUE_MAX) throw new Error(`At most ${QUEUE_MAX} messages can wait in a chat's queue.`)
  // Collab is waiting for you and the chat is free: the message waits, labelled as such (Run anyway = Resume).
  const paused = !busy && waiting ? (q.paused ?? 'collab') : q.paused
  put({ ...q, paused, items: [...q.items, { id: randomUUID(), text: queuedText(input), input, queuedAt: Date.now() }] })
  logInfo('queue add', { conv: input.conversationId, n: getQueue(input.conversationId).items.length })
  return { queue: getQueue(input.conversationId) }
}

export function editQueued(conversationId: string, id: string, text: string): QueueState {
  const t = text.trim(); if (!t) return removeQueued(conversationId, id)
  const { q, i } = find(conversationId, id)
  const it = q.items[i]
  // An edited message is sent as typed: selections folded into the original prompt are dropped.
  const meta = { ...(it.input.messageMetadata ?? {}) }; delete meta.selections; delete meta.displayText
  const items = [...q.items]; items[i] = { ...it, text: t, input: { ...it.input, text: t, messageMetadata: Object.keys(meta).length ? meta : undefined } }
  put({ ...q, items })
  return getQueue(conversationId)
}

export function removeQueued(conversationId: string, id: string): QueueState {
  const { q, i } = find(conversationId, id)
  put({ ...q, items: q.items.filter((_, k) => k !== i) })
  return getQueue(conversationId)
}

export function clearQueue(conversationId: string): QueueState {
  if (queues.has(conversationId)) put(EMPTY_QUEUE(conversationId))
  return getQueue(conversationId)
}

export function resumeQueue(conversationId: string): QueueState {
  put({ ...getQueue(conversationId), paused: null, error: undefined })
  drain(conversationId)
  return getQueue(conversationId)
}

function drain(conversationId: string): void {
  const q = getQueue(conversationId)
  if (isBusy(conversationId) || q.paused || !q.items.length) return
  const [next, ...rest] = q.items
  put({ ...q, items: rest })
  try {
    startTurn(senderForRun(), next.input)
    logInfo('queue run', { conv: conversationId, left: rest.length })
  } catch (e) {
    // e.g. the agent was switched off meanwhile: keep the message and wait for you.
    put({ ...getQueue(conversationId), items: [next, ...getQueue(conversationId).items], paused: 'error', error: cleanErrorMessage(e) })
  }
}

/** Call once at startup, after the database is ready. */
export function initTurnQueue(): void {
  for (const q of parseSavedQueues(getSetting(TURN_QUEUE_SETTING), (id) => !!getConversation(id))) queues.set(q.conversationId, q)
  onTurnIdle((conversationId, outcome, holder) => {
    // Only Collab's own outcomes change whether it waits for you; a chat turn you ran in
    // between (Run anyway) doesn't end that wait.
    if (holder) { if (outcome === 'waiting') collabWaiting.add(conversationId); else collabWaiting.delete(conversationId) }
    // After the finishing turn has settled (its broadcast and hooks); a send that slips in
    // meanwhile queues behind these, because startsNow sees waiting messages.
    setImmediate(() => {
      const r = afterTurn(getQueue(conversationId), outcome)
      if (r.queue !== getQueue(conversationId)) put(r.queue)
      if (r.runNext) drain(conversationId)
    })
  })
}
