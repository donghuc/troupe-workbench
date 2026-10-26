import { useSyncExternalStore } from 'react'
import { api } from './api'
import type { ProviderId } from '../../shared/types'
import type { PermissionMode } from '../../shared/agent'
import type { TurnState, TurnAttachment } from '../../shared/turns'
import { EMPTY_TURN, applyTurnDelta, type TurnDelta } from '../../shared/turns'
import { cleanErrorMessage } from '../../shared/errors'
import { reportError } from './notices'
import { applyQueue } from './queueStore'

// Renderer mirror of main's turn state (D-061). Main owns sequencing, the per-
// conversation lock and the live lanes; this file only subscribes, re-syncs on
// mount (so a reloaded window sees runs already in flight) and tracks "unread",
// which is a pure UI concern: a turn that finished while another chat was open.

export type { TurnState, TurnLane, TurnActivity } from '../../shared/turns'

const state = new Map<string, TurnState>()
const listeners = new Set<() => void>()
let busyIds: string[] = []
let wired = false
let activeConvId: string | null = null
const unread = new Set<string>()
let unreadList: string[] = []

const emit = (): void => { for (const l of listeners) l() }
const recompute = (): void => {
  const b = [...state.values()].filter((s) => s.busy).map((s) => s.conversationId).sort()
  if (b.join(',') !== busyIds.join(',')) busyIds = b
  const u = [...unread].sort()
  if (u.join(',') !== unreadList.join(',')) unreadList = u
}

function apply(next: TurnState): void {
  const prev = state.get(next.conversationId)
  state.set(next.conversationId, next)
  // busy → idle without an error while another chat is on screen = unread dot.
  if (prev?.busy && !next.busy && !next.error && next.conversationId !== activeConvId) unread.add(next.conversationId)
  recompute(); emit()
}

// D-094: streaming text arrives as appends. If this window's copy is behind (it missed
// a message, or has not loaded the turn yet) it fetches the full state once.
const resyncing = new Set<string>()
function applyDelta(d: TurnDelta): void {
  const cur = state.get(d.conversationId)
  const next = cur ? applyTurnDelta(cur, d) : null
  if (next) { if (next !== cur) { state.set(d.conversationId, next); emit() } return }
  if (resyncing.has(d.conversationId)) return
  resyncing.add(d.conversationId)
  api.turns.get(d.conversationId).then(apply)
    .catch((e: unknown) => reportError('Sync running turn', e, { silent: true }))
    .finally(() => resyncing.delete(d.conversationId))
}

function wire(): void {
  if (wired) return
  wired = true
  api.turns.onChanged(apply)
  api.turns.onDelta(applyDelta)
  // Re-sync: anything main has in flight right now (window reload, second window).
  api.turns.snapshot().then((all: TurnState[]) => { for (const s of all) apply(s) }).catch((e: unknown) => reportError('Load running turns', e, { silent: true }))
}

function subscribe(cb: () => void): () => void {
  wire()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// useSyncExternalStore requires a stable snapshot: a fresh EMPTY object per call
// makes React think the store changed on every render and it bails out (blank app).
const empties = new Map<string, TurnState>()
const getRun = (id: string): TurnState => {
  const s = state.get(id); if (s) return s
  let e = empties.get(id); if (!e) { e = EMPTY_TURN(id); empties.set(id, e) }
  return e
}

export function useConversationRun(convId: string): TurnState { return useSyncExternalStore(subscribe, () => getRun(convId)) }
export function useBusyConversations(): string[] { return useSyncExternalStore(subscribe, () => busyIds) }
export function useUnreadConversations(): string[] { return useSyncExternalStore(subscribe, () => unreadList) }

export function setActiveConversation(id: string | null): void {
  activeConvId = id
  if (id && unread.delete(id)) { recompute(); emit() }
}

// ── commands: thin wrappers; a send on a busy conversation waits in its queue (D-138) ──
export async function sendMessage(
  convId: string, cwd: string | undefined, text: string, defaultProvider: ProviderId,
  attachments?: TurnAttachment[], skillId?: string, model?: string, permissionMode?: PermissionMode,
  messageMetadata?: Record<string, unknown>, mode?: import('../../shared/modes').ModeId
): Promise<void> {
  if (!text.trim()) return
  try {
    // D-138: a busy chat queues the message instead of refusing it.
    const r = await api.queue.send({ conversationId: convId, text, defaultProvider, cwd, attachments, skillId, model, permissionMode, messageMetadata, mode })
    applyQueue(r.queue)
    if (r.turn) apply(r.turn)
  } catch (e) {
    apply({ ...getRun(convId), error: cleanErrorMessage(e) })
  }
}

export async function regenerate(
  convId: string, cwd: string | undefined, fromMessageId: string,
  provider: ProviderId, prompt: string, model?: string, skillId?: string
): Promise<void> {
  try {
    apply(await api.turns.regenerate({ conversationId: convId, cwd, fromMessageId, provider, prompt, model, skillId }))
  } catch (e) {
    apply({ ...getRun(convId), error: cleanErrorMessage(e) })
  }
}

export const cancelRun = (convId: string): Promise<void> => api.turns.cancel(convId)
export async function compareReplies(convId: string): Promise<void> { apply(await api.turns.compare(convId)) }

// Force a reload of the conversation's messages (after a destructive edit).
export function reloadConversation(convId: string): void { apply({ ...getRun(convId), rev: getRun(convId).rev + 1 }) }
