import { listProjects, getProject } from '../projects/projectsRepo'
import { listConversations, getConversation, createConversation, listRecentConversations, renameConversation, deleteConversation, searchAll } from '../conversations/conversationsRepo'
import { listMessages, lastUserTurn } from '../conversations/messagesRepo'
import { startTurn, cancelTurn, isBusy, getTurnState } from '../agent/turns'
import { senderForRun, broadcastConversationsChanged } from '../agent/headless'
import { readRunLog } from '../agent/runLog'
import { listSchedules, getSchedule } from '../schedules/schedulesRepo'
import { runScheduleNow } from '../schedules/scheduler'
import { listCollabRuns, getCollabRunBare } from '../collab/collabRepo'
import { listTree, readTextFile } from '../filesystem/fsService'
import { resolveProjectMemory } from '../context/memoryDelivery'
import { getSetting } from '../database/settingsRepo'
import { enabledProviderIds, providerLabel, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { presetsFor, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { modelLists } from '../tools/codexModels'
import { logInfo } from '../util/logger'
import { attachFiles, checkAttachments } from './cliAttach'
import { runCollabCommand } from './cliCollab'
import type { Conversation, Message, ProviderId, FileNode } from '../../shared/types'
import {
  CliError, pickOne, parseMode, parseThink, parseSince, titleFrom, clampLast, clampWait, encodeRunId, decodeRunId,
  projectsText, chatsText, messagesText, statusText, runsText, collabLogState, schedulesText, searchText, describeSchedule,
  filesChanged, isSecretPath, CLI_MAX_MESSAGE,
  type CliProject, type CliChat, type CliMessage, type CliStatus, type CliSchedule, type CliSearchHit
} from '../../shared/cliProtocol'

// Command-line access (D-117, D-118): what the `troupe` command can do. Projects, chats,
// runs, schedules, read-only project files and Collab — every action goes through the same
// functions the window uses (repos, startTurn, the Collab orchestrator), never raw database
// writes. No images, settings, memory/notes/skills edits, project creation/deletion or
// Full access. Deleting is limited to chats started from the command line.

export interface CliResult { status: number; json: unknown; text: string }
type Params = { get(k: string): string | null; getAll(k: string): string[] }

const ok = (json: unknown, text: string): CliResult => ({ status: 200, json, text })
const agentName = (id: string | null | undefined): string => providerLabel(id, 'Assistant')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const findProject = (q: string) => pickOne(listProjects(), q, (p) => p.name, 'project')
function findChat(q: string): Conversation {
  const direct = getConversation(q.trim())
  if (direct) return direct
  return pickOne(listRecentConversations(1000), q, (c) => c.title, 'chat')
}
function findAgent(q: string | null, fallback: ProviderId): ProviderId {
  const on = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING))
  if (!q?.trim()) return on.includes(fallback) ? fallback : on[0]
  return pickOne(on.map((id) => ({ id, name: agentName(id) })), q, (a) => a.name, 'agent').id as ProviderId
}
const toCliMessage = (m: Message): CliMessage => ({ role: m.role === 'user' ? 'user' : 'assistant', agent: m.role === 'user' ? null : agentName(m.provider), text: m.content, at: m.createdAt })
const visible = (m: Message): boolean => m.role === 'user' || m.role === 'assistant'
const busyError = () => new CliError('This chat is already running. Wait for it (troupe status, or send with --wait-free 300) or stop it (troupe stop).', 409)

// ── projects & chats ────────────────────────────────────────────────────────────
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
  const list = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).map((id) => ({ id, name: agentName(id), models: presetsFor(id, lists, off).filter((m) => m.v).map((m) => m.v) }))
  return ok(list, list.map((a) => `${a.name} (${a.id})${a.models.length ? `: ${a.models.join(', ')}` : ''}`).join('\n'))
}
function rename(q: Params): CliResult {
  const c = findChat(q.get('chat') ?? '')
  const title = (q.get('title') ?? '').trim().slice(0, 200)
  if (!title) throw new CliError('The new name is empty.')
  renameConversation(c.id, title); broadcastConversationsChanged()
  logInfo('[cli] rename', { chat: c.id })
  return ok({ chat: c.id, title }, `Renamed to "${title}".`)
}
/** Only chats the command line started: every message you sent in it came from the CLI. */
function startedFromCli(c: Conversation): boolean {
  const users = listMessages(c.id).filter((m) => m.role === 'user')
  if (users.length) return users.every((m) => m.metadata?.via === 'cli')
  return readRunLog(0).some((e) => e.chat === c.id && e.source === 'cli')
}
function remove(q: Params): CliResult {
  const c = findChat(q.get('chat') ?? '')
  if (!startedFromCli(c)) throw new CliError('Only chats started from the command line can be deleted here. Delete other chats in the app.', 403)
  if (isBusy(c.id) || listCollabRuns(c.id).some((r) => ['planning', 'awaiting_confirmation', 'running'].includes(r.status))) throw new CliError('This chat is running. Stop it first.', 409)
  deleteConversation(c.id); broadcastConversationsChanged()
  logInfo('[cli] delete', { chat: c.id })
  return ok({ deleted: c.id }, `Deleted "${c.title}".`)
}
function search(q: Params): CliResult {
  const words = (q.get('query') ?? '').trim()
  if (!words) throw new CliError('Search for something.')
  const hits: CliSearchHit[] = searchAll(words, 20).map((h) => ({ chat: h.conversationId, project: h.projectName, title: h.title, snippet: h.snippet }))
  return ok(hits, searchText(hits))
}
function context(q: Params): CliResult {
  const p = findProject(q.get('project') ?? '')
  const memory = resolveProjectMemory(p)
  const json = { id: p.id, name: p.name, description: p.description, folder: p.folderPath, extraFolders: p.extraFolders, instructions: p.instructions, memory, chats: listConversations(p.id).length }
  const text = [`${p.name}${p.description ? ` — ${p.description}` : ''}`, `folder: ${p.folderPath ?? '(none)'}${p.extraFolders.length ? `\nalso: ${p.extraFolders.join(', ')}` : ''}`,
    '', '## Instructions', p.instructions.trim() || '(none)', '', '## Memory', memory || '(none)'].join('\n')
  return ok(json, text)
}

// ── sending & runs ──────────────────────────────────────────────────────────────
async function send(q: Params, closed: () => boolean): Promise<CliResult> {
  const message = (q.get('message') ?? '').trim()
  if (!message) throw new CliError('The message is empty.')
  if (message.length > CLI_MAX_MESSAGE) throw new CliError(`The message is longer than ${CLI_MAX_MESSAGE} characters.`)
  const mode = parseMode(q.get('mode'))
  const think = parseThink(q.get('think'))
  const target = (q.get('to') ?? '').trim()
  // A chat id continues that chat; a project name (or id) starts a new chat in it.
  let chat = getConversation(target)
  if (chat && q.get('new') === '1') chat = null
  const project = chat ? getProject(chat.projectId) : findProject(target)
  if (!project) throw new CliError('That chat\'s project no longer exists.', 404)
  const agent = findAgent(q.get('agent'), chat?.provider ?? 'claude-code')
  if (chat && isBusy(chat.id)) {
    // --wait-free N: queue behind the running reply instead of failing.
    const until = Date.now() + clampWait(q.get('waitfree')) * 1000
    while (isBusy(chat.id) && Date.now() < until && !closed()) await sleep(1000)
    if (isBusy(chat.id)) throw busyError()
  }
  // Check the files first (a bad path must not leave an empty new chat), then copy them into the chat's folder.
  const attachPaths = q.getAll('attach')
  await checkAttachments(attachPaths)
  if (!chat) { chat = createConversation(project.id, titleFrom(message), agent); broadcastConversationsChanged() }
  const attachments = attachPaths.length ? await attachFiles(attachPaths, project.folderPath, chat.id) : []
  try {
    startTurn(senderForRun(), {
      conversationId: chat.id, text: message, defaultProvider: agent,
      cwd: project.folderPath ?? undefined, permissionMode: mode,
      model: q.get('model')?.trim() || undefined, mode: think,
      attachments: attachments.length ? attachments : undefined,
      messageMetadata: { via: 'cli' }
    })
  } catch (e) {
    if ((e as Error).name === 'ConversationBusyError') throw busyError()
    throw new CliError((e as Error).message || String(e))
  }
  // The run id carries the stored message's own time, so `runs` and `status` agree.
  const sentAt = lastUserTurn(chat.id).user?.createdAt ?? Date.now()
  const run = encodeRunId(chat.id, sentAt)
  logInfo('[cli] send', { chat: chat.id, agent, mode, think, attachments: attachments.length, chars: message.length })
  return ok({ run, chat: chat.id, project: project.name, agent: agentName(agent), mode, attachments: attachments.length },
    `run ${run}\nchat ${chat.id} in ${project.name} · ${agentName(agent)} · ${mode === 'read' ? 'Read-only' : 'Auto'}${think ? ` · ${think}` : ''}${attachments.length ? ` · ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : ''}\nCheck with: troupe status ${run} --wait 600`)
}

/** Where a run stands: its replies so far (and the files they edited), or the live text while it streams. */
function runStatus(run: string): CliStatus {
  const { chatId, sentAt } = decodeRunId(run)
  const conv = getConversation(chatId)
  if (!conv) throw new CliError('That chat no longer exists.', 404)
  const msgs = listMessages(chatId).filter(visible)
  const start = msgs.findIndex((m) => m.role === 'user' && m.createdAt >= sentAt)
  const busy = isBusy(chatId)
  if (start < 0) {
    if (busy) return { run, chat: chatId, state: 'running', replies: [], partial: [], error: null }
    throw new CliError('No message from this run was found in the chat.', 404)
  }
  const after = msgs.slice(start + 1)
  const next = after.findIndex((m) => m.role === 'user')
  const mineMsgs = (next < 0 ? after : after.slice(0, next)).filter((m) => m.role === 'assistant')
  const replies = mineMsgs.map(toCliMessage)
  const files = filesChanged(mineMsgs.map((m) => m.metadata), getProject(conv.projectId)?.folderPath)
  const latest = next < 0
  if (latest && busy) {
    const st = getTurnState(chatId)
    return { run, chat: chatId, state: 'running', replies, partial: st.lanes.filter((l) => !l.done).map((l) => ({ agent: agentName(l.provider), text: l.text })), error: null, files }
  }
  // After a restart the live error is gone; the run log still has it.
  const logged = readRunLog(sentAt - 1).find((e) => e.run === run)
  const err = (latest ? getTurnState(chatId).error : null) ?? (logged?.state === 'error' ? logged.error : null)
  if (!replies.length) return { run, chat: chatId, state: err ? 'error' : 'stopped', replies, partial: [], error: err ?? 'Stopped before any reply.', files }
  return { run, chat: chatId, state: err ? 'error' : logged?.state === 'stopped' ? 'stopped' : 'done', replies, partial: [], error: err, files }
}
async function status(q: Params, closed: () => boolean): Promise<CliResult> {
  const run = q.get('run') ?? ''
  const deadline = Date.now() + clampWait(q.get('wait')) * 1000
  let s = runStatus(run)
  while (s.state === 'running' && Date.now() < deadline && !closed()) { await sleep(1000); s = runStatus(run) }
  return ok(s, statusText(s))
}
async function stop(q: Params): Promise<CliResult> {
  const { chatId } = decodeRunId(q.get('run') ?? '')
  if (!isBusy(chatId)) return ok({ stopped: false }, 'Nothing is running in that chat.')
  await cancelTurn(chatId)
  logInfo('[cli] stop', { chat: chatId })
  return ok({ stopped: true }, 'Stopped.')
}
function runs(q: Params): CliResult {
  const since = parseSince(q.get('since'))
  const project = q.get('project')?.trim() ? findProject(q.get('project')!).name : null
  const source = q.get('source')?.trim().toLowerCase() || null
  const list = readRunLog(since).filter((e) => (!project || e.project === project) && (!source || e.source === source))
    .map((e) => {
      if (e.kind !== 'collab') return e
      const run = getCollabRunBare(e.run)
      // Its chat was deleted, and the run with it: nothing left to look up.
      if (!run) return { ...e, state: 'deleted' as const, error: 'The run and its chat were deleted.' }
      const st = collabLogState(run.status, run.reason)
      return { ...e, ...st, finishedAt: st.state === 'running' ? e.finishedAt : run.updatedAt }
    })
  return ok(list, runsText(list))
}

// ── schedules ───────────────────────────────────────────────────────────────────
function schedules(q: Params): CliResult {
  if (q.get('do') === 'run') {
    const all = listSchedules()
    const s = pickOne(all, q.get('task') ?? '', (x) => x.title, 'scheduled task')
    const before = Date.now()
    runScheduleNow(getSchedule(s.id) ?? s)
    const chat = listConversations(s.projectId).filter((c) => c.updatedAt >= before).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const sent = chat ? lastUserTurn(chat.id).user : null
    const run = chat && sent && sent.createdAt >= before ? encodeRunId(chat.id, sent.createdAt) : null
    logInfo('[cli] schedule run', { task: s.id })
    return ok({ task: s.id, run, chat: chat?.id ?? null }, run ? `Started "${s.title}".\nrun ${run}\nCheck with: troupe status ${run} --wait 600` : `Asked "${s.title}" to run; it didn't start (its agent may be off or its chat busy). See troupe runs.`)
  }
  const list: CliSchedule[] = listSchedules().map((s) => ({
    id: s.id, title: s.title || 'Scheduled task', project: getProject(s.projectId)?.name ?? '', agent: agentName(s.provider),
    when: describeSchedule(s.kind, s.intervalMin, s.atMin), enabled: s.enabled, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, chat: s.convId
  }))
  return ok(list, schedulesText(list))
}

// ── project files (read-only) ───────────────────────────────────────────────────
function flatten(n: FileNode, out: { path: string; type: 'file' | 'dir'; modified: number | null; more: boolean }[]): void {
  for (const c of n.children ?? []) {
    if (isSecretPath(c.relPath)) continue
    out.push({ path: c.relPath + (c.type === 'dir' ? '/' : ''), type: c.type, modified: c.mtime ?? null, more: !!c.truncated })
    if (c.type === 'dir') flatten(c, out)
  }
}
async function files(q: Params): Promise<CliResult> {
  const p = findProject(q.get('project') ?? '')
  if (!p.folderPath) throw new CliError(`${p.name} has no folder.`)
  const sub = (q.get('path') ?? '').trim().replace(/^\/+/, '')
  if (sub && isSecretPath(sub)) throw new CliError('That folder holds keys or credentials; it isn\'t listed.', 403)
  const tree = await listTree(p.folderPath, sub)
  const list: { path: string; type: 'file' | 'dir'; modified: number | null; more: boolean }[] = []
  flatten(tree, list)
  const shown = list.slice(0, 500)
  const text = shown.length ? shown.map((f) => `${f.path}${f.more ? '  (not expanded — troupe files <project> ' + f.path + ')' : ''}`).join('\n') + (list.length > 500 ? `\n… ${list.length - 500} more` : '') : 'No files.'
  return ok({ project: p.name, folder: p.folderPath, files: shown, more: Math.max(0, list.length - 500) }, text)
}
async function cat(q: Params): Promise<CliResult> {
  const p = findProject(q.get('project') ?? '')
  if (!p.folderPath) throw new CliError(`${p.name} has no folder.`)
  const rel = (q.get('path') ?? '').trim().replace(/^\/+/, '')
  if (!rel) throw new CliError('Name a file.')
  if (isSecretPath(rel)) throw new CliError(`${rel} looks like a key or credentials file; it isn't readable here.`, 403)
  try {
    const text = await readTextFile(p.folderPath, rel)
    return ok({ project: p.name, path: rel, content: text }, text.replace(/\n$/, ''))
  } catch (e) {
    const m = (e as Error).message
    if (/ENOENT/.test(m)) throw new CliError(`No file ${rel} in ${p.name}.`, 404)
    if (/escapes/.test(m)) throw new CliError('That path is outside the project folder.', 403)
    throw new CliError(/binary|BINARY/.test(m) ? `${rel} isn't a text file.` : /large|LARGE/.test(m) ? `${rel} is too large to show (over 5 MB).` : m)
  }
}

export async function runCliCommand(cmd: string, q: Params, closed: () => boolean = () => false): Promise<CliResult> {
  try {
    switch (cmd) {
      case 'projects': return projects()
      case 'chats': return chats(q)
      case 'show': return show(q)
      case 'agents': return agents()
      case 'send': return await send(q, closed)
      case 'status': return await status(q, closed)
      case 'stop': return await stop(q)
      case 'runs': return runs(q)
      case 'schedules': return schedules(q)
      case 'rename': return rename(q)
      case 'delete': return remove(q)
      case 'search': return search(q)
      case 'context': return context(q)
      case 'files': return await files(q)
      case 'cat': return await cat(q)
      case 'collab': return await runCollabCommand(q, { findProject, findAgent }, closed)
      default: throw new CliError(`Unknown command "${cmd}". Try: troupe --help`, 404)
    }
  } catch (e) {
    const status = e instanceof CliError ? e.status : 500
    const message = e instanceof Error ? e.message : String(e)
    return { status, json: { error: message }, text: `error: ${message}` }
  }
}
