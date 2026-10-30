// D-146: guarded resume. Troupe's database stays the record (D-009); resuming the agent's own
// session is only a shortcut, taken when it can't disagree with what Troupe would send:
// the same agent answered the message right before this one, nothing was added, deleted or
// edited since, in the same folder, with the same model and project context, recently enough
// that its prompt cache is still warm. Measured (Hien, Opus): 6 turns $2.29 → $0.77.

/** What a reply records so the next turn can resume its session. */
export interface ResumeMark {
  sessionId: string
  /** Messages in the chat once this reply was saved (it included). */
  count: number
  cwd: string
  model: string | null
  /** Hash of the project context and skills the run was given. */
  ctxKey: string
  at: number
  /** Claude reports the session's running cost; a resumed reply's own cost is the difference. */
  sessionCostUsd?: number
}

/** This reply's own cost from the session total, given the total when the resumed reply ended. */
export function turnCost(sessionTotal: number | undefined, before: number | undefined): number | undefined {
  if (typeof sessionTotal !== 'number') return sessionTotal
  return typeof before === 'number' && sessionTotal >= before ? sessionTotal - before : sessionTotal
}

/** The agent's prompt cache lasts an hour; resume only inside it, with a margin. */
export const RESUME_WINDOW_MS = 55 * 60_000
export const RESUME_SETTING = 'agent_resume'   // '0' = always send the conversation (D-009 behaviour)

interface MsgLike { role: string; provider?: string | null; metadata?: Record<string, unknown> | null }

/** The session to resume, or null to run fresh with the conversation. `prev` is the message right
 *  before the one being answered; `count` is the chat's message count now (the new message included). */
export function resumeSession(prev: MsgLike | undefined, now: { providerId: string; count: number; cwd: string; model: string | null; ctxKey: string; at: number }): string | null {
  if (!prev || prev.role !== 'assistant' || prev.provider !== now.providerId) return null
  const meta = prev.metadata ?? {}
  if (meta.partial || meta.timedOut) return null
  const m = meta.resume as Partial<ResumeMark> | undefined
  if (!m || typeof m.sessionId !== 'string' || !m.sessionId) return null
  if (m.count !== now.count - 1) return null            // something added, deleted or edited since
  if (m.cwd !== now.cwd || (m.model ?? null) !== now.model || m.ctxKey !== now.ctxKey) return null
  if (typeof m.at !== 'number' || now.at - m.at > RESUME_WINDOW_MS || now.at < m.at) return null
  return m.sessionId
}
