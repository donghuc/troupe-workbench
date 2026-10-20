import { startCollab, confirmPlan, stopCollab, resumeCollab, recoverTask, applyRepair, setCollabMode } from '../collab/orchestrator'
import { getCollabRun, listCollabRuns } from '../collab/collabRepo'
import { getConversation, createConversation, listConversations } from '../conversations/conversationsRepo'
import { getProject, listProjects } from '../projects/projectsRepo'
import { listMessages } from '../conversations/messagesRepo'
import { senderForRun, broadcastConversationsChanged } from '../agent/headless'
import { appendRunLog } from '../agent/runLog'
import { logInfo } from '../util/logger'
import { providerLabel } from '../../shared/providers'
import { scopePaths } from '../../shared/collabFiles'
import { triesText } from '../../shared/collabChecks'
import { CliError, parseMode, titleFrom, clampWait, collabText, type CliCollab } from '../../shared/cliProtocol'
import type { CollabRun, ProviderId, Project } from '../../shared/types'

// D-118: Collab from the command line — the same orchestrator calls the Collab card makes.
// The plan gate stays: nothing runs until `approve`, and the bot guide says to ask the user
// before approving or picking a fix that changes the goal.

type Deps = {
  findProject: (q: string) => Project
  findAgent: (q: string | null, fallback: ProviderId) => ProviderId
}
type Params = { get(k: string): string | null }
const WAITING = ['planning', 'running']

function findCollab(q: string): CollabRun {
  const id = q.trim()
  if (!id) throw new CliError('Name a Collab run (or its chat id).')
  const direct = getCollabRun(id)
  if (direct) return direct
  if (getConversation(id)) {
    const latest = listCollabRuns(id)[0]
    if (latest) return getCollabRun(latest.id)!
    throw new CliError('That chat has no Collab run.', 404)
  }
  throw new CliError(`No Collab run ${id}.`, 404)
}

function describeCollab(run: CollabRun): CliCollab {
  const conv = getConversation(run.conversationId)
  const project = conv ? getProject(conv.projectId) : null
  const tasks = (run.tasks ?? []).map((t, i) => ({
    // D-121: a review task has no Maker — its only agent is the reviewer (test 6 read as
    // "Claude made and reviewed T3").
    n: i + 1, title: t.title, status: t.status, kind: t.kind,
    agent: t.kind === 'review' ? '' : providerLabel(t.provider ?? run.providerId),
    reviewer: providerLabel(t.meta.reviewer ?? run.providerId),
    // D-121: every attempt, not just since the last reassignment (attempts resets then)
    attempts: Math.max(t.attempts, t.meta.tries?.length ?? 0), tries: triesText(t.meta.tries, (a) => providerLabel(a), false), produces: scopePaths(t.scope).outputs.join(', '),
    findings: t.lastVerdict?.verdict === 'FAIL' ? t.lastVerdict.findings : [], files: t.handoff?.filesChanged ?? [],
    // D-121: per-task timing
    startedAt: t.meta.startedAt ?? null, finishedAt: t.status === 'in_progress' ? null : t.meta.finishedAt ?? null,
    seconds: t.meta.startedAt ? Math.round(((t.status === 'in_progress' ? Date.now() : t.meta.finishedAt ?? Date.now()) - t.meta.startedAt) / 1000) : null
  }))
  const fixes = (run.repair?.options ?? []).map((o, i) => ({ n: i + 1, label: o.label, recommended: i === run.repair!.recommended, needsYou: o.userStep ?? null, changesGoal: o.changesGoal, raisesPermissions: o.action === 'mode' }))
  return { run: run.id, chat: run.conversationId, project: project?.name ?? '', goal: run.goal, status: run.status, mode: run.permissionMode, reason: run.reason, tasks, fixes, summary: run.summary, wrapUp: wrapUpOf(run) }
}
/** D-121: the Planner's wrap-up message for this run, if one was written. */
function wrapUpOf(run: CollabRun): string {
  const ms = listMessages(run.conversationId)
  for (let i = ms.length - 1; i >= 0; i--) {
    const c = ms[i].metadata?.collab as { runId?: string; role?: string } | undefined
    if (c?.runId === run.id && c.role === 'wrapup') return ms[i].content
  }
  return ''
}
const result = (run: CollabRun | null) => {
  if (!run) throw new CliError('That Collab run no longer exists.', 404)
  const c = describeCollab(getCollabRun(run.id) ?? run)
  return { status: 200, json: c, text: collabText(c) }
}
const taskId = (run: CollabRun, n: string | null): string => {
  const i = Number(n) - 1
  const t = run.tasks?.[i]
  if (!t) throw new CliError(`No task ${n} in this run (it has ${run.tasks?.length ?? 0}).`, 404)
  return t.id
}

export async function runCollabCommand(q: Params, deps: Deps, closed: () => boolean) {
  const sub = (q.get('do') ?? '').trim()
  switch (sub) {
    case 'start': {
      const project = deps.findProject(q.get('project') ?? '')
      if (!project.folderPath) throw new CliError(`${project.name} has no folder; Collab needs one.`)
      const goal = (q.get('goal') ?? '').trim()
      if (!goal) throw new CliError('The goal is empty.')
      const agent = deps.findAgent(q.get('agent'), 'claude-code')
      const mode = parseMode(q.get('mode'))
      const chat = createConversation(project.id, titleFrom(goal), agent)
      broadcastConversationsChanged()
      const run = startCollab(senderForRun(), { conversationId: chat.id, cwd: project.folderPath, providerId: agent, model: q.get('model')?.trim() || undefined, permissionMode: mode, goal })
      logInfo('[cli] collab start', { run: run.id, chat: chat.id, agent, mode })
      appendRunLog({ run: run.id, kind: 'collab', chat: chat.id, project: project.name, title: chat.title, source: 'cli', agents: [agent], startedAt: Date.now(), finishedAt: Date.now(), state: 'started', error: null, files: [] })
      return result(run)
    }
    case 'list': {
      // D-121: no project = every project's runs (`collab list --json` read "--json" as the project).
      const name = (q.get('project') ?? '').trim()
      const projects = name ? [deps.findProject(name)] : listProjects()
      const runs = projects.flatMap((p) => listConversations(p.id)).flatMap((c) => listCollabRuns(c.id)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
      const json = runs.map((r) => ({ run: r.id, chat: r.conversationId, status: r.status, goal: r.goal, updatedAt: r.updatedAt }))
      return { status: 200, json, text: json.length ? json.map((r) => `${r.run}  ${r.status.replace('_', ' ')}  ${r.goal.split('\n')[0].slice(0, 80)}`).join('\n') : name ? 'No Collab runs in this project.' : 'No Collab runs yet.' }
    }
    case 'status': {
      let run = findCollab(q.get('run') ?? '')
      const deadline = Date.now() + clampWait(q.get('wait')) * 1000
      while (WAITING.includes(run.status) && Date.now() < deadline && !closed()) {
        await new Promise((r) => setTimeout(r, 1500))
        run = getCollabRun(run.id) ?? run
      }
      return result(run)
    }
    case 'approve': {
      const run = findCollab(q.get('run') ?? '')
      if (run.status !== 'awaiting_confirmation') throw new CliError(`Nothing to approve: the run is ${run.status.replace('_', ' ')}.`, 409)
      return result(confirmPlan(senderForRun(), run.id))
    }
    case 'reject':
    case 'stop': {
      const run = findCollab(q.get('run') ?? '')
      if (['done', 'stopped', 'failed'].includes(run.status)) throw new CliError(`The run is already ${run.status}.`, 409)
      return result(stopCollab(run.id))
    }
    case 'resume': {
      const run = findCollab(q.get('run') ?? '')
      if (run.status !== 'needs_attention') throw new CliError(`Only a paused run can resume; this one is ${run.status.replace('_', ' ')}.`, 409)
      return result(resumeCollab(senderForRun(), run.id))
    }
    case 'fix': {
      const run = findCollab(q.get('run') ?? '')
      const n = Number(q.get('n'))
      if (!run.repair || !run.repair.options[n - 1]) throw new CliError(run.repair ? `Pick a fix from 1 to ${run.repair.options.length}.` : 'There is no fix waiting on this run.', 409)
      return result(applyRepair(senderForRun(), run.id, n - 1))
    }
    case 'mode': {
      // D-127: Read-only ⇄ Auto only (never Full access), before approving or while paused.
      const run = findCollab(q.get('run') ?? '')
      const m = (q.get('mode') ?? '').trim().toLowerCase()
      if (m !== 'read' && m !== 'auto') throw new CliError('Use: troupe collab mode <run> read|auto (Full access is never available here).')
      if (!['awaiting_confirmation', 'needs_attention'].includes(run.status)) throw new CliError(`Switch the mode before approving or while paused; the run is ${run.status.replace('_', ' ')}.`, 409)
      const was = run.permissionMode
      const r = result(setCollabMode(run.id, m))
      const word = m === 'auto' ? 'Auto (agents can change files)' : 'Read-only (Troupe saves agents\' files from their replies)'
      // D-128: say what happened — the reply used to be the plain status, with nothing about the mode.
      return { ...r, text: `${was === m ? 'Already' : 'Switched to'} ${word}.\n\n${r.text}` }
    }
    case 'retry':
    case 'skip':
    case 'ask': {
      const run = findCollab(q.get('run') ?? '')
      if (run.status !== 'needs_attention') throw new CliError(`The run isn't paused on a task (it is ${run.status.replace('_', ' ')}).`, 409)
      const note = q.get('note')?.trim() || undefined
      const action = sub === 'retry' ? { type: 'retry' as const, note } : sub === 'skip' ? { type: 'skip' as const, note } : { type: 'repair' as const, note }
      return result(recoverTask(senderForRun(), run.id, taskId(run, q.get('task')), action))
    }
    default:
      throw new CliError('Collab commands: start, list, status, approve, reject, stop, resume, fix, retry, skip, ask, mode.', 404)
  }
}
