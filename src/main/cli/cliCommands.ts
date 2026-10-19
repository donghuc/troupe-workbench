import { listProjects, getProject } from '../projects/projectsRepo'
import { listConversations, getConversation, createConversation, listRecentConversations } from '../conversations/conversationsRepo'
import { listMessages } from '../conversations/messagesRepo'
import { startTurn, cancelTurn, isBusy, getTurnState } from '../agent/turns'
import { senderForRun, broadcastConversationsChanged } from '../agent/headless'
import { getSetting } from '../database/settingsRepo'
import { enabledProviderIds, providerLabel, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { presetsFor, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { modelLists } from '../tools/codexModels'
import { logInfo } from '../util/logger'
import type { Conversation, Message, ProviderId } from '../../shared/types'
import {
  CliError, pickOne, parseMode, titleFrom, clampLast, clampWait, encodeRunId, decodeRunId,
  projectsText, chatsText, messagesText, statusText, CLI_MAX_MESSAGE,
  type CliProject, type CliChat, type CliMessage, type CliStatus
} from '../../shared/cliProtocol'

// Command-line access (D-117): what the `troupe` command can do. Projects and chats only —
// every action goes through the same functions the window uses (repos, startTurn,
// cancelTurn), never raw database writes. No images, settings, memory, notes, skills,
// project creation/deletion or Full access.

export interface CliResult { status: number; json: unknown; text: string }
type Params = { get(k: string): string | null }

const ok = (json: unknown, text: string): CliResult => ({ status: 200, json, text })
const agentName = (id: string | null | undefined): string => providerLabel(id, 'Assistant')
const chatLabel = (c: Conversation): string => c.title

function findProject(q: string) {
  return pickOne(listProjects(), q, (p) => p.name, 'project')
}
function findChat(q: string): Conversation {
  const direct = getConversation(q.trim())
  if (direct) return direct
  return pickOne(listRecentConversations(1000), q, chatLabel, 'chat')
}
function findAgent(q: string | null, fallback: ProviderId): ProviderId {
  const on = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING))
  if (!q?.trim()) return on.includes(fallback) ? fallback : on[0]
  const items = on.map((id) => ({ id, name: agentName(id) }))
  const hit = pickOne(items, q, (a) => a.name, 'agent')
  return hit.id as ProviderId
}
const toCliMessage = (m: Message): CliMessage => ({ role: m.role === 'user' ? 'user' : 'assistant', agent: m.role === 'user' ? null : agentName(m.provider), text: m.content, at: m.createdAt })
const visible = (m: Message): boolean => m.role === 'user' || m.role === 'assistant'

function projects(): CliResult {
  const ps: CliProject[] = listProjects().map((p) => ({ id: p.id, name: p.name, folder: p.folderPath, chats: listConversations(p.id).length }))
  return ok(ps, projectsText(ps))
}

function chats(q: Params): CliResult {
  const p = findProject(q.get('project') ?? '')
  const cs: CliChat[] = listConversations(p.id).map((c) => ({ id: c.id, title: c.title, agent: agentName(c.provider), updatedAt: c.updatedAt, busy: isBusy(c.id) }))
  return ok({ project: { id: p.id, name: p.name }, chats: cs }, chatsText(cs))
}

function show(q: Params): CliResult {
  const c = findChat(q.get('chat') ?? '')
  const ms = listMessages(c.id).filter(visible).slice(-clampLast(q.get('last'))).map(toCliMessage)
  return ok({ chat: { id: c.id, title: c.title }, busy: isBusy(c.id), messages: ms }, `${c.title}${isBusy(c.id) ? '  [running]' : ''}\n\n${messagesText(ms)}`)
}

function agents(): CliResult {
  const lists = modelLists(); const off = parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))
  const list = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).map((id) => ({
    id, name: agentName(id), models: presetsFor(id, lists, off).filter((m) => m.v).map((m) => m.v)
  }))
  return ok(list, list.map((a) => `${a.name} (${a.id})${a.models.length ? `: ${a.models.join(', ')}` : ''}`).join('\n'))
}

function send(q: Params): CliResult {
  const message = (q.get('message') ?? '').trim()
  if (!message) throw new CliError('The message is empty.')
  if (message.length > CLI_MAX_MESSAGE) throw new CliError(`The message is longer than ${CLI_MAX_MESSAGE} characters.`)
  const mode = parseMode(q.get('mode'))
  const target = (q.get('to') ?? '').trim()
  // A chat id continues that chat; a project name (or id) starts a new chat in it.
  let chat = getConversation(target)
  if (chat && q.get('new') === '1') chat = null
  const project = chat ? getProject(chat.projectId) : findProject(target)
  if (!project) throw new CliError('That chat\'s project no longer exists.', 404)
  const agent = findAgent(q.get('agent'), chat?.provider ?? 'claude-code')
  if (chat && isBusy(chat.id)) throw new CliError('This chat is already running. Wait for it (troupe status) or stop it (troupe stop).', 409)
  if (!chat) { chat = createConversation(project.id, titleFrom(message), agent); broadcastConversationsChanged() }
  const sentAt = Date.now()
  try {
    startTurn(senderForRun(), {
      conversationId: chat.id, text: message, defaultProvider: agent,
      cwd: project.folderPath ?? undefined, permissionMode: mode,
      model: q.get('model')?.trim() || undefined,
      messageMetadata: { via: 'cli' }
    })
  } catch (e) {
    throw new CliError((e as Error).message || String(e), (e as Error).name === 'ConversationBusyError' ? 409 : 400)
  }
  const run = encodeRunId(chat.id, sentAt)
  logInfo('[cli] send', { chat: chat.id, agent, mode, chars: message.length })
  return ok({ run, chat: chat.id, project: project.name, agent: agentName(agent), mode },
    `run ${run}\nchat ${chat.id} in ${project.name} · ${agentName(agent)} · ${mode === 'read' ? 'Read-only' : 'Auto'}\nCheck with: troupe status ${run} --wait 600`)
}

/** Where a run stands: its replies so far, or the live text while it streams. */
function runStatus(run: string): CliStatus {
  const { chatId, sentAt } = decodeRunId(run)
  if (!getConversation(chatId)) throw new CliError('That chat no longer exists.', 404)
  const msgs = listMessages(chatId).filter(visible)
  const start = msgs.findIndex((m) => m.role === 'user' && m.createdAt >= sentAt)
  const busy = isBusy(chatId)
  if (start < 0) {
    if (busy) return { run, chat: chatId, state: 'running', replies: [], partial: [], error: null }
    throw new CliError('No message from this run was found in the chat.', 404)
  }
  const after = msgs.slice(start + 1)
  const next = after.findIndex((m) => m.role === 'user')
  const mine = next < 0 ? after : after.slice(0, next)
  const latest = next < 0
  const replies = mine.filter((m) => m.role === 'assistant').map(toCliMessage)
  if (latest && busy) {
    const st = getTurnState(chatId)
    return { run, chat: chatId, state: 'running', replies, partial: st.lanes.filter((l) => !l.done).map((l) => ({ agent: agentName(l.provider), text: l.text })), error: null }
  }
  const err = latest ? getTurnState(chatId).error : null
  if (!replies.length) return { run, chat: chatId, state: err ? 'error' : 'stopped', replies, partial: [], error: err ?? 'Stopped before any reply.' }
  return { run, chat: chatId, state: err ? 'error' : 'done', replies, partial: [], error: err }
}

async function status(q: Params, closed: () => boolean): Promise<CliResult> {
  const run = q.get('run') ?? ''
  const deadline = Date.now() + clampWait(q.get('wait')) * 1000
  let s = runStatus(run)
  while (s.state === 'running' && Date.now() < deadline && !closed()) {
    await new Promise((r) => setTimeout(r, 1000))
    s = runStatus(run)
  }
  return ok(s, statusText(s))
}

async function stop(q: Params): Promise<CliResult> {
  const { chatId } = decodeRunId(q.get('run') ?? '')
  if (!isBusy(chatId)) return ok({ stopped: false }, 'Nothing is running in that chat.')
  await cancelTurn(chatId)
  logInfo('[cli] stop', { chat: chatId })
  return ok({ stopped: true }, 'Stopped.')
}

export async function runCliCommand(cmd: string, q: Params, closed: () => boolean = () => false): Promise<CliResult> {
  try {
    switch (cmd) {
      case 'projects': return projects()
      case 'chats': return chats(q)
      case 'show': return show(q)
      case 'agents': return agents()
      case 'send': return send(q)
      case 'status': return await status(q, closed)
      case 'stop': return await stop(q)
      default: throw new CliError(`Unknown command "${cmd}". Try: projects, chats, show, send, status, stop, agents.`, 404)
    }
  } catch (e) {
    const status = e instanceof CliError ? e.status : 500
    const message = e instanceof Error ? e.message : String(e)
    return { status, json: { error: message }, text: `error: ${message}` }
  }
}
