import { noteWrite } from './recentWrites'
import { fileBase } from '../../shared/platform'
import { randomUUID } from 'crypto'
import { app, type WebContents } from 'electron'
import type { ProviderId } from '../../shared/types'
import type { AgentEvent, ProviderContext, AgentAction, TokenUsage } from '../../shared/agent'
import { createProvider } from '../providers/registry'
import { appendMessage } from '../conversations/messagesRepo'
import { buildProjectContext, buildConversationContext, resolveAddDirs, resolveMcpOff } from '../context/contextBuilder'
import { maybeCompress } from './snapshotService'
import { setConversationModel } from '../conversations/conversationsRepo'
import type { AgentProvider } from '../providers/AgentProvider'
import { logInfo, logError } from '../util/logger'
import { getSkillById } from '../skills/skillsFs'
import { getNumberSetting } from '../database/settingsRepo'

interface RunParams {
  conversationId: string
  providerId: ProviderId
  prompt: string
  cwd?: string
  addDirs?: string[]       // usually left unset — resolved main-side from the project (D-054)
  context?: ProviderContext
  resumeSessionId?: string
  attachments?: { path: string; content?: string; image?: boolean; doc?: boolean }[]
  skillId?: string
  skillIds?: string[]
  noConversationContext?: boolean   // collab sub-runs rely on files/handoffs, not the growing transcript   // multiple skills, injected in order (e.g. collab protocol + role) — provider-agnostic
  model?: string
  permissionMode?: import('../../shared/agent').PermissionMode
  allowWeb?: boolean       // read mode only: also allow web search/fetch (collab Reviewer, D-064)
  onDone?: (messageId: string | null, error?: string) => void
  onEvent?: (event: AgentEvent) => void   // main-side observer (turn orchestration, D-061)
  chained?: boolean
  parallelGroup?: string
  timeoutMs?: number       // hard deadline for this run; default from the run_timeout_min setting (D-060 item 4)
  extraMetadata?: Record<string, unknown>   // merged into the saved reply's metadata (e.g. { synthesis: true }, D-081)
}

// Defaults for the run watchdog (D-060 item 4). Both are user settings (minutes);
// 0 disables. Collab passes a longer deadline explicitly.
const DEFAULT_RUN_TIMEOUT_MIN = 15
const DEFAULT_IDLE_WARN_MIN = 5
export function runTimeoutMs(): number { return getNumberSetting('run_timeout_min', DEFAULT_RUN_TIMEOUT_MIN) * 60_000 }

// Pull a useful label out of a tool's input object (file path, command, query).
function actionDetail(input: unknown): string | undefined {
  if (typeof input === 'string') return input.slice(0, 80)
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const path = o.file_path ?? o.path ?? o.notebook_path
    if (typeof path === 'string') return path.length > 80 ? '…' + path.slice(-79) : path
    const cmd = o.command ?? o.pattern ?? o.query ?? o.url
    if (typeof cmd === 'string') return cmd.length > 80 ? cmd.slice(0, 79) + '…' : cmd
  }
  return undefined
}

// The raw (untruncated) file path a tool acted on, for opening in the viewer.
function actionPath(input: unknown): string | undefined {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const p = o.file_path ?? o.path ?? o.notebook_path
    if (typeof p === 'string') return p
  }
  return undefined
}

const WRITE_TOOL = /^(write|edit|multiedit|notebookedit|write_file|edit_file|create_file|apply_patch|str_replace_editor|replace)$/i
const active = new Map<string, AgentProvider>()

export function startRun(sender: WebContents, params: RunParams): string {
  const runId = randomUUID()
  const provider = createProvider(params.providerId)
  // Events go to the caller only (turns, collab, Compare). Windows learn about runs from
  // the turn state; the old per-event agent:event push had no listener (D-099).
  const emit = (event: AgentEvent) => {
    try { params.onEvent?.(event) } catch { /* observer must not break the run */ }
  }
  const done = (messageId: string | null, error?: string) => {
    active.delete(runId)
    try { params.onDone?.(messageId, error) } catch { /* notify best-effort */ }
  }

  if (!provider) { setImmediate(() => done(null, `Unknown provider: ${params.providerId}`)); return runId }
  active.set(runId, provider)

  const cwd = params.cwd && params.cwd.length ? params.cwd : app.getPath('temp')
  // Additional folders come from the DB, not the caller (D-054): chat, the scheduler
  // and collab all reach this line, so none of them need a new argument.
  const addDirs = params.addDirs ?? resolveAddDirs(params.conversationId)
  // V0.1: Workbench owns conversation memory. Instead of resuming each provider's
  // native session (which gives it a PRIVATE history that fragments/contradicts the
  // shared conversation), we inject the full recent transcript every turn and run
  // the provider without resume (D-009); long chats are compressed into a snapshot.
  // The provider's session id is still recorded in message metadata for debugging.
  const resume: string | undefined = undefined
  let context: ProviderContext = { ...(params.context ?? {}), ...buildProjectContext(params.conversationId) }
  let handoffUsed = false
  if (!params.noConversationContext) {
    const convBlock = buildConversationContext(params.conversationId, params.chained ? 0 : 1)
    if (convBlock) {
      context = { ...context, snapshot: convBlock }
      handoffUsed = true
    }
  }
  // Skills reach every provider the same way: their body text is injected into the
  // prompt context (see each provider's context assembly). skillIds are applied in
  // order, then any legacy single skillId — deduped. This is what lets a Codex or
  // Claude orchestrator both receive the collab protocol + role skills identically.
  const skillIds = [...(params.skillIds ?? []), ...(params.skillId ? [params.skillId] : [])]
    .filter((id, i, arr) => arr.indexOf(id) === i)
  if (skillIds.length) {
    const blocks = skillIds
      .map((id) => getSkillById(id, params.cwd))
      .filter((sk): sk is NonNullable<typeof sk> => !!sk)
      .map((sk) => `# Skill: ${sk.name}\n\n${sk.body}`)
    if (blocks.length) context = { ...context, skillText: blocks.join('\n\n') }
  }
  if (params.attachments && params.attachments.length > 0) {
    context = {
      ...context,
      attachmentsText: '# Attached files for this message\n\n' +
        params.attachments.map((a) => a.image
          ? `## Image: ${a.path}\n(Read this image file with your tools if you need to see it.)`
          : a.doc
          ? `## File: ${a.path}\n(This document — e.g. a PDF — is in the project folder. Read it with your tools to see its contents.)`
          : `## ${a.path}\n\n${a.content ?? ''}`).join('\n\n')
    }
  }
  // Secondary agents in a multi-agent turn (chained) must not clobber the
  // conversation's remembered model set by the primary agent.
  if (params.model !== undefined && !params.chained) setConversationModel(params.conversationId, params.model || null)
  const contextMode: 'shared' | 'fresh' = handoffUsed ? 'shared' : 'fresh'
  ;(async () => {
    const avail = await provider.isAvailable()
    if (!avail.installed) {
      emit({ type: 'error', message: `${provider.name} CLI not found. Install it, then check the Providers panel.`, fatal: true })
      logError('run aborted: CLI not installed', { provider: params.providerId })
      return done(null, `${provider.name} CLI not found`)
    }
    const startedAt = Date.now()
    logInfo('run start', { provider: params.providerId, contextMode, conv: params.conversationId })
    // Watchdog (D-060 item 4): a CLI that hangs must not hold the conversation busy
    // forever. Hard deadline → cancel the provider and report a timeout error; idle
    // warning → a status line in the lane after N minutes with no event at all.
    const timeoutMs = params.timeoutMs ?? runTimeoutMs()
    const idleWarnMs = getNumberSetting('run_idle_warn_min', DEFAULT_IDLE_WARN_MIN) * 60_000
    let timedOut = false
    const deadline = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true
      logError('run timed out', { provider: params.providerId, conv: params.conversationId, ms: timeoutMs })
      emit({ type: 'status', message: `No response after ${Math.round(timeoutMs / 60_000)} min — stopping…` })
      void provider.cancel().catch(() => {})
    }, timeoutMs) : null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      if (idleWarnMs > 0) idleTimer = setTimeout(() => emit({ type: 'status', message: `Still working — no output for ${Math.round(idleWarnMs / 60_000)} min` }), idleWarnMs)
    }
    const clearWatchdog = (): void => { if (deadline) clearTimeout(deadline); if (idleTimer) clearTimeout(idleTimer) }
    armIdle()
    if (handoffUsed) emit({ type: 'status', message: 'Reading the conversation…' })
    let full = ''
    let providerSessionId: string | undefined
    let modelUsed: string | undefined
    let usage: TokenUsage | undefined
    const actions: AgentAction[] = []
    try {
      for await (const ev of provider.run({ prompt: params.prompt, context, cwd, addDirs, model: params.model || undefined, permissionMode: params.permissionMode, allowWeb: params.allowWeb, mcpOff: resolveMcpOff(params.conversationId, params.providerId) }, resume)) {
        armIdle()
        emit(ev)
        if (ev.type === 'text_delta') full += ev.text
        else if (ev.type === 'tool_start') {
          const p = actionPath(ev.input)
          actions.push({ kind: 'tool', label: ev.tool, detail: actionDetail(ev.input), path: p, at: Date.now() })
          if (p && WRITE_TOOL.test(ev.tool)) noteWrite(p, params.providerId)   // D-087
        }
        else if (ev.type === 'file_changed') { actions.push({ kind: 'file', label: fileBase(ev.path) || ev.path, detail: ev.kind, path: ev.path, at: Date.now() }); noteWrite(ev.path, params.providerId) }
        else if (ev.type === 'session_started') { providerSessionId = ev.providerSessionId; modelUsed = ev.model }
        else if (ev.type === 'complete') { usage = ev.usage }
        else if (ev.type === 'error' && ev.fatal) {
          clearWatchdog()
          const saved = full.trim()
            ? appendMessage({ conversationId: params.conversationId, role: 'assistant', provider: params.providerId, content: full, metadata: { providerSessionId, modelUsed, contextMode, partial: true, actions, ...(params.parallelGroup ? { parallelGroup: params.parallelGroup } : {}), ...(params.extraMetadata ?? {}) } })
            : null
          return done(saved?.id ?? null, ev.message)
        }
      }
      clearWatchdog()
      if (timedOut) {
        // Killed by the deadline: the provider may end cleanly (signal exit → no error
        // event), so treat the run as failed here rather than saving it as complete.
        const msg = `${provider.name} timed out after ${Math.round(timeoutMs / 60_000)} min with no reply.`
        emit({ type: 'error', message: msg, fatal: true })
        const saved = full.trim()
          ? appendMessage({ conversationId: params.conversationId, role: 'assistant', provider: params.providerId, content: full, metadata: { providerSessionId, modelUsed, contextMode, partial: true, timedOut: true, actions, ...(params.parallelGroup ? { parallelGroup: params.parallelGroup } : {}), ...(params.extraMetadata ?? {}) } })
          : null
        return done(saved?.id ?? null, msg)
      }
      const saved = appendMessage({
        conversationId: params.conversationId, role: 'assistant', provider: params.providerId,
        content: full, metadata: { providerSessionId, modelUsed, contextMode, usage, actions, ...(params.parallelGroup ? { parallelGroup: params.parallelGroup } : {}), ...(params.extraMetadata ?? {}) }
      })
      logInfo('run complete', { provider: params.providerId, chars: full.length, ms: Date.now() - startedAt, conv: params.conversationId })
      done(saved.id)
      void maybeCompress(params.conversationId, sender) // fire-and-forget, visible + failure-safe
    } catch (err) {
      clearWatchdog()
      emit({ type: 'error', message: String(err), fatal: true })
      const saved = full.trim()
        ? appendMessage({ conversationId: params.conversationId, role: 'assistant', provider: params.providerId, content: full, metadata: { providerSessionId, modelUsed, contextMode, partial: true, actions, ...(params.parallelGroup ? { parallelGroup: params.parallelGroup } : {}), ...(params.extraMetadata ?? {}) } })
        : null
      done(saved?.id ?? null, String(err))
    }
  })()

  return runId
}

export async function cancelRun(runId: string): Promise<void> {
  await active.get(runId)?.cancel()
}

export async function cancelAllRuns(): Promise<void> {
  for (const p of active.values()) { try { await p.cancel() } catch { /* ignore */ } }
  active.clear()
}
