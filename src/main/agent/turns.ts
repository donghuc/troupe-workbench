import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ProviderId } from '../../shared/types'
import type { AgentEvent } from '../../shared/agent'
import type { TurnState, TurnLane, StartTurnInput, RegenerateInput, TurnAttachment } from '../../shared/turns'
import { EMPTY_TURN, turnDelta } from '../../shared/turns'
import { startRun, cancelRun } from './runner'
import { planTurn } from './turnPlan'
import { appendMessage, deleteMessagesFrom, listMessages } from '../conversations/messagesRepo'
import { setConversationPermissionMode, getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { appendRunLog } from './runLog'
import { encodeRunId, filesChanged } from '../../shared/cliProtocol'
import { modelForProvider, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { getSetting } from '../database/settingsRepo'
import { enabledProviderIds, offMessage, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { getDb } from '../database/db'
import { logInfo, logWarn } from '../util/logger'
import { modelLists } from '../tools/codexModels'
import { lastUserTurn } from '../conversations/messagesRepo'
import { resolveThinkingAgent, buildComparePrompt, THINKING_AGENT_SETTING, THINKING_MODEL_SETTING, COMPARE_AUTO_SETTING } from '../../shared/thinking'
import { MODES, parseModeTemplates, buildModeSteps, describeCast, MODES_SETTING, type ModeStep } from '../../shared/modes'

// Turn orchestration lives here, in main (D-061 / audit #5). One user message →
// one turn → one run, an @a @b chain, or an @all fan-out. Main owns the
// per-conversation lock and the live lane state; windows only mirror it.
//
// Lock rule (Hien, 2026-09-21): a second send on a busy conversation is REFUSED,
// not queued. An @all fan-out holds one lock until its last lane finishes.

interface Turn {
  plan: { mode: 'sequential' | 'parallel'; chain: ProviderId[]; prompt: string }
  i: number
  cwd?: string
  attachments?: TurnAttachment[]
  skillId?: string
  model?: string
  permMode?: StartTurnInput['permissionMode']
  parallelGroup?: string
  pending: number
  cancelled: boolean
  runIds: Set<string>
  sender: WebContents
  // D-081: this turn is (or has moved on to) a Compare card over these replies.
  compare?: { replies: { provider: ProviderId; text: string }[]; question: string; group?: string; of?: string[] }
  // D-083: a thinking-mode run — one step per chain entry, each with its role instruction and skill.
  steps?: ModeStep[]
  modeSkill?: string
  // D-118: what the run log needs when the turn ends (the user message's time and where it came from).
  log?: { at: number; source: 'app' | 'cli' | 'schedule' }
}

const turns = new Map<string, Turn>()
const state = new Map<string, TurnState>()
// Lock holders that are not chat turns (collab runs). They block sends the same way.
const external = new Map<string, string>()
const hooks = new Map<string, { onFinished?: (error?: string) => void }>()

class ConversationBusyError extends Error {
  constructor() { super('This conversation is already running a turn. Wait for it to finish or stop it.'); this.name = 'ConversationBusyError' }
}

export const isBusy = (conversationId: string): boolean => turns.has(conversationId) || external.has(conversationId)
export const getTurnState = (conversationId: string): TurnState => state.get(conversationId) ?? EMPTY_TURN(conversationId)
// ── broadcast (coalesced: text_delta arrives many times a second) ─────────────
const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
// What every window was last sent, per conversation: the base for the next delta (D-094).
const lastSent = new Map<string, TurnState>()
function broadcastNow(conversationId: string): void {
  const st = getTurnState(conversationId)
  const d = turnDelta(lastSent.get(conversationId), st)
  if (d && d.append.length === 0) return
  lastSent.set(conversationId, st)
  if (!st.busy && st.lanes.length === 0) lastSent.delete(conversationId)   // idle: next send is full
  const [channel, payload] = d ? [IPC.turnsDelta, d] as const : [IPC.turnsChanged, st] as const
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload) }
}
function broadcast(conversationId: string, immediate = false): void {
  if (immediate) { dirty.delete(conversationId); broadcastNow(conversationId); return }
  dirty.add(conversationId)
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; for (const id of [...dirty]) { dirty.delete(id); broadcastNow(id) } }, 40)
}
function set(conversationId: string, patch: Partial<TurnState>, immediate = false): void {
  state.set(conversationId, { ...getTurnState(conversationId), ...patch })
  broadcast(conversationId, immediate)
}
const bumpRev = (id: string): void => set(id, { rev: getTurnState(id).rev + 1 }, true)
function updateLane(conversationId: string, provider: ProviderId, fn: (l: TurnLane) => TurnLane): void {
  const cur = getTurnState(conversationId)
  set(conversationId, { lanes: cur.lanes.map((l) => (l.provider === provider ? fn(l) : l)) })
}

// ── lock persistence: only so a startup sweep can report interrupted turns ────
function lockRow(conversationId: string, chain: ProviderId[], parallel: boolean): void {
  try {
    getDb().prepare('INSERT OR REPLACE INTO turns (conversation_id, chain, parallel, started_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, JSON.stringify(chain), parallel ? 1 : 0, Date.now())
  } catch { /* table missing only before migration v18 */ }
}
function unlockRow(conversationId: string): void {
  try { getDb().prepare('DELETE FROM turns WHERE conversation_id = ?').run(conversationId) } catch { /* ignore */ }
}
// Called once at startup, before any window: turns the previous process left
// running are gone with it (streaming state is memory-only), so just clear the lock.
export function sweepInterruptedTurns(): number {
  try {
    const n = getDb().prepare('DELETE FROM turns').run().changes
    if (n) logWarn('cleared turn locks left by a previous process', { n })
    return n
  } catch { return 0 }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
const codexExtra = modelLists   // each agent's own newest models + typed extras (D-076, D-078)

function finish(conversationId: string): void {
  const t = turns.get(conversationId)
  turns.delete(conversationId)
  unlockRow(conversationId)
  const err = getTurnState(conversationId).error
  if (t?.log) logFinishedTurn(conversationId, t, err)
  set(conversationId, { busy: false, lanes: [], parallel: false, phase: undefined }, true)
  const h = hooks.get(conversationId); hooks.delete(conversationId)
  try { h?.onFinished?.(err ?? undefined) } catch { /* best-effort */ }
}

// D-118: one run-log line per finished turn: outcome, agents and the files they edited.
function logFinishedTurn(conversationId: string, t: Turn, err: string | null): void {
  try {
    const conv = getConversation(conversationId); if (!conv || !t.log) return
    const project = getProject(conv.projectId)
    const replies = listMessages(conversationId).filter((m) => m.role === 'assistant' && m.createdAt >= t.log!.at)
    const replied = [...new Set(replies.map((m) => m.provider).filter((p): p is ProviderId => !!p))]
    appendRunLog({
      run: encodeRunId(conversationId, t.log.at), kind: 'chat', chat: conversationId, project: project?.name ?? '', title: conv.title,
      source: t.log.source, agents: replied.length ? replied : t.plan.chain,
      startedAt: t.log.at, finishedAt: Date.now(), state: t.cancelled ? 'stopped' : err ? 'error' : 'done', error: err,
      files: filesChanged(replies.map((m) => m.metadata), project?.folderPath)
    })
  } catch { /* the log is best-effort */ }
}

function onEvent(conversationId: string, provider: ProviderId, ev: AgentEvent): void {
  const now = Date.now()
  const withActivity = (label: string) => (l: TurnLane): TurnLane => ({ ...l, activity: { label, startedAt: l.activity?.startedAt ?? now } })
  switch (ev.type) {
    case 'session_started': updateLane(conversationId, provider, (l) => ({ ...l, activity: l.activity ?? { label: 'Thinking…', startedAt: now } })); break
    case 'status': updateLane(conversationId, provider, withActivity(ev.message)); break
    case 'tool_start': {
      const detail = typeof ev.input === 'string' ? ev.input : ''
      updateLane(conversationId, provider, withActivity(`Running ${ev.tool}${detail ? ` · ${detail.slice(0, 40)}` : ''}…`)); break
    }
    case 'tool_end': updateLane(conversationId, provider, withActivity('Working…')); break
    case 'file_changed': updateLane(conversationId, provider, withActivity(`Edited ${ev.path}`)); break
    case 'text_delta': updateLane(conversationId, provider, (l) => ({ ...l, text: l.text + ev.text, activity: { label: 'Responding…', startedAt: l.activity?.startedAt ?? now } })); break
  }
}

function onDone(conversationId: string, provider: ProviderId, runId: string, error?: string): void {
  const t = turns.get(conversationId); if (!t) return
  t.runIds.delete(runId)
  if (error) set(conversationId, { error })
  if (t.compare) { bumpRev(conversationId); finish(conversationId); return }   // the Compare run itself just ended
  if (t.plan.mode === 'parallel') {
    updateLane(conversationId, provider, (l) => ({ ...l, done: true, activity: null }))
    t.pending -= 1
    if (t.pending > 0 && !t.cancelled) return
    // All replies are in. Compare (D-081): one more short run writes the card; the lanes
    // stay on screen meanwhile and rev is bumped only at the end, so nothing flickers.
    const lanes = getTurnState(conversationId).lanes
    const answered = lanes.filter((l) => l.text.trim())
    if (!t.cancelled && answered.length >= 2 && getSetting(COMPARE_AUTO_SETTING) !== '0') {
      t.compare = { replies: answered.map((l) => ({ provider: l.provider, text: l.text })), question: t.plan.prompt, group: t.parallelGroup }
      startCompare(conversationId)
      return
    }
    bumpRev(conversationId); finish(conversationId)
    return
  }
  set(conversationId, { lanes: [] })
  bumpRev(conversationId)
  if (error || t.cancelled) { finish(conversationId); return }
  t.i += 1
  runNext(conversationId)
}

function dispatch(conversationId: string, provider: ProviderId, chained: boolean): void {
  const t = turns.get(conversationId); if (!t) return
  const step = t.steps?.[t.i]
  const prompt = step ? `[${step.instruction}]\n\nThe proposition / request:\n${t.plan.prompt}` : t.plan.prompt
  const runId = startRun(t.sender, {
    conversationId, providerId: provider, prompt, cwd: t.cwd,
    attachments: t.attachments, skillId: t.skillId, skillIds: t.modeSkill ? [`global/${t.modeSkill}`] : undefined, permissionMode: t.permMode,
    model: modelForProvider(provider, t.model, codexExtra(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))) || undefined,   // a model switched off falls back to the agent's default (D-072)
    chained, parallelGroup: t.parallelGroup,
    onEvent: (ev) => onEvent(conversationId, provider, ev),
    onDone: (_mid, err) => onDone(conversationId, provider, runId, err)
  })
  t.runIds.add(runId)
}

function runNext(conversationId: string): void {
  const t = turns.get(conversationId)
  if (t && !t.cancelled && t.steps && t.i >= t.plan.chain.length) {
    // A mode run ends with a Compare card over its steps (D-083), like @all does.
    const replies = lastUserTurn(conversationId).after.filter((m) => m.role === 'assistant' && m.provider && m.content.trim())
    if (replies.length >= 2) {
      t.compare = { replies: replies.map((m) => ({ provider: m.provider!, text: m.content })), question: t.plan.prompt, of: replies.map((m) => m.id) }
      set(conversationId, { lanes: [] })
      startCompare(conversationId)
      return
    }
  }
  if (!t || t.cancelled || t.i >= t.plan.chain.length) { finish(conversationId); return }
  const provider = t.plan.chain[t.i]
  set(conversationId, { lanes: [{ provider, text: '', activity: { label: 'Starting…', startedAt: Date.now() }, done: false }], parallel: false }, true)
  dispatch(conversationId, provider, t.i > 0)
}

// Compare (D-081): the drafting agent (Settings ▸ Thinking) reads the replies and writes
// the card. Runs read-only with no conversation context — everything it needs is in the
// prompt — and is saved as an assistant message tagged `synthesis`, grouped with the
// replies when they came from @all. Any failure just means no card.
function startCompare(conversationId: string): void {
  const t = turns.get(conversationId); if (!t?.compare) return
  const agent = resolveThinkingAgent(getSetting(THINKING_AGENT_SETTING), getSetting(DISABLED_AGENTS_SETTING), t.plan.chain[0])
  const model = modelForProvider(agent, getSetting(THINKING_MODEL_SETTING) || undefined, codexExtra(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))) || undefined
  set(conversationId, { phase: 'compare' }, true)
  logInfo('compare start', { conv: conversationId, agent, replies: t.compare.replies.length })
  const runId = startRun(t.sender, {
    conversationId, providerId: agent, prompt: buildComparePrompt(t.compare), cwd: t.cwd, model,
    permissionMode: 'read', noConversationContext: true, chained: true,
    parallelGroup: t.compare.group,
    extraMetadata: { synthesis: true, synthesisAgent: agent, ...(t.compare.of ? { synthesisOf: t.compare.of } : {}) },
    onEvent: () => { /* the card is shown once saved; no lane */ },
    onDone: (_mid, err) => { if (err) logWarn('compare failed', { conv: conversationId, err }); onDone(conversationId, agent, runId, undefined) }
  })
  t.runIds.add(runId)
}

// Compare on demand (D-081): the assistant replies since the last user message — a
// turn-by-turn debate, or an @all whose automatic card was off. Holds the lock like a turn.
export function compareTurn(sender: WebContents, conversationId: string): TurnState {
  if (isBusy(conversationId)) throw new ConversationBusyError()
  const { user, after } = lastUserTurn(conversationId)
  if (!user) return getTurnState(conversationId)
  const replies = after.filter((m) => m.role === 'assistant' && m.provider && !m.metadata?.synthesis && m.content.trim())
  if (replies.length < 2) return getTurnState(conversationId)
  const turn: Turn = {
    plan: { mode: 'sequential', chain: [replies[0].provider!], prompt: user.content }, i: 0, pending: 0, cancelled: false, runIds: new Set(), sender,
    compare: { replies: replies.map((m) => ({ provider: m.provider!, text: m.content })), question: user.content, of: replies.map((m) => m.id) }
  }
  turns.set(conversationId, turn)
  lockRow(conversationId, [], false)
  set(conversationId, { busy: true, error: null, lanes: [], parallel: false }, true)
  startCompare(conversationId)
  return getTurnState(conversationId)
}

// Blind-parallel: every agent answers the same prompt at once. All runs are
// dispatched together with chained:false, so each builds its context (the shared
// transcript up to this user message) before any sibling reply is persisted.
function startParallel(conversationId: string): void {
  const t = turns.get(conversationId); if (!t) return
  t.pending = t.plan.chain.length
  set(conversationId, { lanes: t.plan.chain.map((provider) => ({ provider, text: '', activity: { label: 'Starting…', startedAt: Date.now() }, done: false })), parallel: true }, true)
  for (const provider of t.plan.chain) dispatch(conversationId, provider, false)
}

// Send a message: append it once (with the original @mentions visible), then run.
export function startTurn(sender: WebContents, input: StartTurnInput, h?: { onFinished?: (error?: string) => void }): TurnState {
  if (!input.text.trim()) return getTurnState(input.conversationId)
  if (isBusy(input.conversationId)) throw new ConversationBusyError()
  if (h) hooks.set(input.conversationId, h)
  let plan = planTurn(input.text, input.defaultProvider, enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)))
  if (plan.blocked) throw new Error(offMessage(plan.blocked))   // D-071: refused before anything is saved
  // Thinking mode (D-083): the message is the proposition; the template decides who plays what.
  let steps: ModeStep[] | undefined
  let modeHeader: Record<string, unknown> = {}
  const thinking = plan.thinking ?? input.mode
  if (thinking && MODES[thinking]) {
    const tpl = parseModeTemplates(getSetting(MODES_SETTING))[thinking]
    steps = buildModeSteps(thinking, tpl, getSetting(DISABLED_AGENTS_SETTING))
    plan = { mode: 'sequential', chain: steps.map((s) => s.provider), prompt: plan.prompt }
    modeHeader = { mode: thinking, modeCast: describeCast(thinking, tpl, getSetting(DISABLED_AGENTS_SETTING)) }
  }
  const attMeta = input.attachments?.map((a) => ({ name: a.path.split('/').pop() || a.path, image: !!a.image, path: a.path, viewable: !!a.viewable }))
  const meta = { ...(input.messageMetadata ?? {}), ...modeHeader, ...(attMeta && attMeta.length ? { attachments: attMeta } : {}) }
  const userMsg = appendMessage({ conversationId: input.conversationId, role: 'user', content: input.text, metadata: Object.keys(meta).length ? meta : null })
  const turn: Turn = {
    plan, i: 0, cwd: input.cwd, attachments: input.attachments, skillId: input.skillId, model: input.model, permMode: input.permissionMode,
    parallelGroup: plan.mode === 'parallel' ? userMsg.id : undefined, pending: 0, cancelled: false, runIds: new Set(), sender,
    steps, modeSkill: thinking ? MODES[thinking].skill : undefined,
    log: { at: userMsg.createdAt, source: input.messageMetadata?.via === 'cli' ? 'cli' : input.messageMetadata?.scheduled ? 'schedule' : 'app' }
  }
  if (input.permissionMode) setConversationPermissionMode(input.conversationId, input.permissionMode)
  turns.set(input.conversationId, turn)
  lockRow(input.conversationId, plan.chain, plan.mode === 'parallel')
  set(input.conversationId, { busy: true, error: null }, true)
  bumpRev(input.conversationId)
  logInfo('turn start', { conv: input.conversationId, mode: plan.mode, chain: plan.chain })
  if (plan.mode === 'parallel') startParallel(input.conversationId); else runNext(input.conversationId)
  return getTurnState(input.conversationId)
}

// Re-run one agent on the preceding user turn: drop `fromMessageId` and after,
// then run WITHOUT appending a new user message (the prompt is already there).
export function regenerateTurn(sender: WebContents, input: RegenerateInput): TurnState {
  if (!input.prompt.trim()) return getTurnState(input.conversationId)
  if (isBusy(input.conversationId)) throw new ConversationBusyError()
  if (!enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(input.provider)) throw new Error(offMessage([input.provider]))
  deleteMessagesFrom(input.conversationId, input.fromMessageId)
  const turn: Turn = {
    plan: { mode: 'sequential', chain: [input.provider], prompt: input.prompt }, i: 0, cwd: input.cwd, model: input.model, skillId: input.skillId,
    pending: 0, cancelled: false, runIds: new Set(), sender
  }
  turns.set(input.conversationId, turn)
  lockRow(input.conversationId, [input.provider], false)
  set(input.conversationId, { busy: true, error: null }, true)
  bumpRev(input.conversationId)
  runNext(input.conversationId)
  return getTurnState(input.conversationId)
}

export async function cancelTurn(conversationId: string): Promise<void> {
  const t = turns.get(conversationId); if (!t) return
  t.cancelled = true
  for (const rid of [...t.runIds]) { try { await cancelRun(rid) } catch { /* ignore */ } }
}

// A window that (re)opened asks for everything in flight so its mirror is complete.
export function snapshotTurns(): TurnState[] { return [...turns.keys()].map(getTurnState) }

// ── external holders (collab, D-061 commit c) ────────────────────────────────
// A collab run holds the conversation's lock while an agent is working on its
// behalf, so a chat message can't interleave with a Planner/Maker/Reviewer. The
// mirror shows the conversation busy with no lanes (collab has its own card).
export function acquireLock(conversationId: string, holder: string): boolean {
  if (isBusy(conversationId)) return external.get(conversationId) === holder
  external.set(conversationId, holder)
  lockRow(conversationId, [], false)
  set(conversationId, { busy: true, lanes: [], parallel: false, error: null }, true)
  return true
}
export function releaseLock(conversationId: string, holder: string): void {
  if (external.get(conversationId) !== holder) return
  external.delete(conversationId)
  unlockRow(conversationId)
  set(conversationId, { busy: false }, true)
}
