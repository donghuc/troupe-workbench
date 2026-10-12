import type { ProviderId } from './types'
import type { PermissionMode } from './agent'

// Turn state owned by main and mirrored to every window (D-061). A "turn" is one
// user message and the agent run(s) it triggers: a single run, an @a @b chain run
// one after another, or an @all fan-out run side by side.

export interface TurnActivity { label: string; startedAt: number }
export interface TurnLane { provider: ProviderId; text: string; activity: TurnActivity | null; done: boolean }
export interface TurnState {
  conversationId: string
  busy: boolean
  parallel: boolean        // lanes render side by side
  lanes: TurnLane[]
  error: string | null
  rev: number              // bumps when the conversation's messages should be reloaded
  phase?: 'compare'        // D-081: the replies are in; the drafting agent is writing the Compare card
}

export interface TurnAttachment { path: string; content?: string; image?: boolean; doc?: boolean; viewable?: boolean }

export interface StartTurnInput {
  conversationId: string
  text: string
  defaultProvider: ProviderId
  cwd?: string
  attachments?: TurnAttachment[]
  skillId?: string
  model?: string
  permissionMode?: PermissionMode
  messageMetadata?: Record<string, unknown>   // extra metadata on the stored user message (e.g. { scheduled: true })
  mode?: import('./modes').ModeId   // thinking mode (D-083): debate | critique | research
}

export interface RegenerateInput {
  conversationId: string
  cwd?: string
  fromMessageId: string
  provider: ProviderId
  prompt: string
  model?: string
  skillId?: string
}

export const EMPTY_TURN = (conversationId: string): TurnState =>
  ({ conversationId, busy: false, parallel: false, lanes: [], error: null, rev: 0 })

// ── Streaming deltas (D-094) ───────────────────────────────────────────────────
// While an agent streams, the only change between two broadcasts is usually text
// appended to a lane. Sending the whole TurnState every 40 ms made IPC O(n²) in the
// reply length; main now sends just the appended text when nothing else changed.

/** Text appended to lane `i`, which was `from` characters long when main last sent it. */
export interface TurnAppend { i: number; from: number; text: string }
export interface TurnDelta { conversationId: string; append: TurnAppend[] }

const sameActivity = (a: TurnActivity | null, b: TurnActivity | null): boolean =>
  a === b || (!!a && !!b && a.label === b.label && a.startedAt === b.startedAt)

/** The delta from `prev` to `next`, or null when only a full state can describe it. */
export function turnDelta(prev: TurnState | undefined, next: TurnState): TurnDelta | null {
  if (!prev || prev.conversationId !== next.conversationId) return null
  if (prev.busy !== next.busy || prev.parallel !== next.parallel || prev.error !== next.error ||
      prev.rev !== next.rev || prev.phase !== next.phase || prev.lanes.length !== next.lanes.length) return null
  const append: TurnAppend[] = []
  for (let i = 0; i < next.lanes.length; i++) {
    const a = prev.lanes[i]; const b = next.lanes[i]
    if (a.provider !== b.provider || a.done !== b.done || !sameActivity(a.activity, b.activity)) return null
    if (b.text.length < a.text.length || !b.text.startsWith(a.text)) return null
    if (b.text.length > a.text.length) append.push({ i, from: a.text.length, text: b.text.slice(a.text.length) })
  }
  return { conversationId: next.conversationId, append }
}

/**
 * Apply a delta to the window's copy. Tolerates overlap: a window that just re-synced
 * may already hold part of the appended text. Returns null when the copy is behind
 * (missing text) or shaped differently — the caller then fetches the full state.
 */
export function applyTurnDelta(cur: TurnState, d: TurnDelta): TurnState | null {
  if (cur.conversationId !== d.conversationId) return null
  let lanes = cur.lanes
  for (const ap of d.append) {
    const lane = lanes[ap.i]
    if (!lane) return null
    const have = lane.text.length
    if (have < ap.from) return null                      // a gap: we missed text
    const skip = have - ap.from                          // already have this much of it
    if (skip >= ap.text.length) continue                 // already ahead
    if (lanes === cur.lanes) lanes = [...cur.lanes]
    lanes[ap.i] = { ...lane, text: lane.text + ap.text.slice(skip) }
  }
  return lanes === cur.lanes ? cur : { ...cur, lanes }
}
