// Collab orchestration (D-061, D-099, D-108–D-128): the run's state machine — plan, approve,
// run each task (Maker → checks → Reviewer), finish with the wrap-up, stop and resume. The
// pieces it uses live beside it since audit #12 (2026-10-27): runtime.ts (lock, launch, change
// broadcast), agents.ts, prompts.ts, runFiles.ts, records.ts and recovery.ts.
import { type WebContents } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { cancelRun } from '../agent/runner'
import { getMessage } from '../conversations/messagesRepo'
import { logInfo, logError } from '../util/logger'
import type { CollabRun, CollabTaskDraft, CollabStartInput, CollabVerdict, CollabHandoff } from '../../shared/types'
import { PERMISSION_BLOCKED_RE } from '../../shared/collabRecovery'
import { planBudget, planIssues, parseWrapUp } from '../../shared/collabChecks'
import { createCollabRun, getCollabRun, getCollabRunBare, updateCollabRun, replaceTasks, getTask, updateTask, listCollabRuns, setBudget } from './collabRepo'
import { extractJson, findingToText } from './parse'
import { scopePaths, missingOutputs, filesFromReply, FILE_BLOCK_START } from '../../shared/collabFiles'
import { needOfTool, needOfText } from '../../shared/collabAbilities'
import { snapshot } from './projectSnapshot'
import { ensureInside } from '../filesystem/fsService'
import { nextRunnable, tasksToRetry, defaultOutputDir, sanitizeOutputDir } from '../../shared/collabPlan'
import { resolveTaskModel, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { getSetting } from '../database/settingsRepo'
import { modelLists } from '../tools/codexModels'
import { isCustomAgentId, providerLabel } from '../../shared/providers'
import { agentsForPlanner, canWriteFiles, endTry, makerProviderOf, providerLabelOf, replyFiles, reviewerOf, startTry, strongModel } from './agents'
import { makerContract, plannerContract, readHint, reviewerContract, textMakerContract, wrapUpPrompt } from './prompts'
import { forgetSnaps, makerSnaps, recordAttempt, recordText } from './records'
import { onTaskFailed, planChangesContext, reviewBlocked, reviewerCouldNotCheck, runLimited } from './recovery'
import { TASK_NUM, appendStatus, completedContext, ensureOutputDirs, inlineInputs, outputsHash, probeIn, relRunDir, retargetTasks, writePlanMd } from './runFiles'
import { loop, claimFor, launchRole, SK_MAKER, SK_PLANNER, SK_PROTOCOL, SK_REVIEWER, activeRunId, emitChanged, lockFor, pause, senderFor, today, unlockFor, wc } from './runtime'

// ── public API ────────────────────────────────────────────────────────────────
const ACTIVE_STATUSES = ['planning', 'awaiting_confirmation', 'running', 'needs_attention']

export function startCollab(sender: WebContents, input: CollabStartInput): CollabRun {
  // One active run per conversation: if one is already in flight, return it
  // untouched rather than spawning a competing run into the same folder.
  const existing = listCollabRuns(input.conversationId).find((r) => ACTIVE_STATUSES.includes(r.status))
  if (existing) { senderFor.set(existing.id, sender); return getCollabRun(existing.id) ?? existing }
  const run = createCollabRun(input)
  senderFor.set(run.id, sender)
  // Planner and Reviewer need tool steps and structured replies; user-added agents (2.4)
  // can be Makers but not lead a run.
  if (isCustomAgentId(run.providerId)) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: `${providerLabel(run.providerId)} can do Collab tasks but can't plan or review. Switch this conversation to Claude, Codex, Gemini or Grok to start Collab.` })!
    emitChanged(run.id)
    return failed
  }
  // P0-1: check the folder before taking the chat's lock (a failure here used to keep it locked).
  if (!input.cwd || !input.cwd.trim()) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: 'Collab mode requires a project folder.' })!
    emitChanged(run.id)
    return failed
  }
  if (!lockFor(run)) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: 'This conversation is busy with another turn. Wait for it to finish, then start Collab again.' })!
    emitChanged(run.id)
    return failed
  }
  emitChanged(run.id)
  runPlanner(run.id)
  return run
}

function runPlanner(runId: string): void {
  const run = getCollabRunBare(runId); if (!run) return
  const sender = claimFor(run); if (!sender) return
  const prompt = [
    `You are the Planner for a Collab run. Goal:`, '', run.goal, '',
    `Read the shared files under \`${relRunDir(run)}/\` if they exist.`,
    plannerContract(relRunDir(run), defaultOutputDir(run.goal, run.createdAt)),
    agentsForPlanner(run)
  ].join('\n')
  launchRole(run, sender, {
    role: 'planner', group: 'planner', label: 'Planner',
    params: { providerId: run.providerId, prompt, permissionMode: run.permissionMode, model: strongModel(run.providerId) || undefined, skillIds: [SK_PROTOCOL, SK_PLANNER] },
    onDone: (mid, err) => onPlannerDone(runId, mid, err)
  })
}

function onPlannerDone(runId: string, messageId: string | null, err?: string): void {
  const run = getCollabRun(runId); if (!run || run.status === 'stopped') return
  if (err || !messageId) { updateCollabRun(runId, { status: 'failed', reason: err || 'Planner produced no output.' }); unlockFor(run, 'error'); emitChanged(runId); return }
  const text = getMessage(messageId)?.content ?? ''
  const parsed = extractJson<{ tasks?: CollabTaskDraft[]; outputDir?: unknown; conflicts?: unknown }>(text)
  const tasks = parsed?.tasks
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    updateCollabRun(runId, { status: 'failed', reason: 'Could not read a task list from the plan. You can start Collab again.' }); unlockFor(run, 'error'); emitChanged(runId); return
  }
  // D-064: deliverables go to a visible folder; any task path the Planner still put
  // under the hidden run folder is moved there.
  const outputDir = sanitizeOutputDir(parsed?.outputDir, defaultOutputDir(run.goal, run.createdAt))
  replaceTasks(runId, retargetTasks(tasks, relRunDir(run), outputDir))
  updateCollabRun(runId, { outputDir })
  const fresh = getCollabRun(runId)!
  writePlanMd(fresh, fresh.tasks!)
  // D-121: what to check before approving — the Planner's conflicts in the goal, then the
  // app's own plan checks (paths outside the folder, two tasks on one file, …). Shown on the
  // card and by `troupe collab status`; the user decides.
  updateCollabRun(runId, { status: 'awaiting_confirmation', reason: checksText(fresh, parsed?.conflicts) })
  unlockFor(fresh, 'waiting')   // queued messages wait for your Approve / Stop
  emitChanged(runId)
  logInfo(`[collab] plan ready: ${tasks.length} tasks`)
}

/** Lines to check before approving a plan (D-121), joined for the run's `reason`. */

function checksText(run: CollabRun, conflicts?: unknown): string {
  const fromPlanner = Array.isArray(conflicts) ? conflicts.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim()).slice(0, 5) : []
  const exists = (rel: string) => { try { return existsSync(ensureInside(run.projectCwd, rel)) } catch { return false } }
  const fromApp = planIssues((run.tasks ?? []).map((t) => ({ id: t.id, title: t.title, kind: t.kind, scope: t.scope, dependsOn: t.dependsOn })), run.outputDir, exists)
  return [...fromPlanner, ...fromApp].join('\n')
}

export function confirmPlan(sender: WebContents, runId: string, editedTasks?: CollabTaskDraft[]): CollabRun | null {
  const run = getCollabRun(runId); if (!run) return null
  senderFor.set(runId, sender)
  if (run.status !== 'awaiting_confirmation') return run
  if (editedTasks && editedTasks.length) replaceTasks(runId, run.outputDir ? retargetTasks(editedTasks, relRunDir(run), run.outputDir) : editedTasks)
  const fresh = getCollabRun(runId)!
  writePlanMd(fresh, fresh.tasks!)
  // D-121: a budget sized to the plan (was a flat 24 agent runs).
  const budget = { ...fresh.budget, maxRuns: Math.max(fresh.budget.maxRuns, planBudget(fresh.tasks!, fresh.budget.maxRetriesPerTask)) }
  updateCollabRun(runId, { status: 'running', reason: '', budget })
  emitChanged(runId)
  step(runId)
  return getCollabRun(runId)
}

export function stopCollab(runId: string): CollabRun | null {
  const run = getCollabRun(runId); if (!run) return null
  forgetSnaps(run)
  const rid = activeRunId.get(runId)
  if (rid) { activeRunId.delete(runId); void cancelRun(rid).catch(() => {}) }
  const wasPlanning = run.status === 'planning' || run.status === 'awaiting_confirmation'
  // D-121: a stopped run still gets a wrap-up — what got done, what didn't — once any task ran.
  const worked = !wasPlanning && (run.tasks ?? []).some((t) => t.attempts > 0)
  const stopped = updateCollabRun(runId, { status: 'stopped', reason: worked ? 'Stopped by you. Writing a short wrap-up…' : 'Stopped by you.', ...(wasPlanning ? {} : { summary: countsSummary(run, true) }) })
  // P0-3: with a wrap-up to write, the run keeps the chat until it's written (onWrapUpDone
  // releases it as 'stopped'), so a queued message can't run first and push the wrap-up out.
  if (!worked) unlockFor(run, 'stopped')
  emitChanged(runId)
  logInfo('[collab] stopped', { run: runId, was: run.status, wrapUp: worked })
  // After the cancelled agent has let go of the conversation (its own onDone ignores a stopped run).
  if (worked) setTimeout(() => {
    if (!runWrapUp(runId, 'stopped')) { updateCollabRun(runId, { reason: 'Stopped by you.' }); unlockFor(run, 'stopped'); emitChanged(runId) }
  }, 1500)
  return stopped
}

export function resumeCollab(sender: WebContents, runId: string, opts?: { raiseBudget?: boolean }): CollabRun | null {
  const run = getCollabRunBare(runId); if (!run) return null
  senderFor.set(runId, sender)
  if (run.status !== 'needs_attention') return run
  if (run.repair) updateCollabRun(runId, { repair: null })
  // Resume retries what failed (D-064): a crashed run (bad model, CLI error) or a task
  // that failed review goes back in the queue with a fresh retry budget. The last
  // reviewer findings are kept, so the Maker's retry prompt still carries them.
  for (const t of tasksToRetry(getCollabRun(runId)?.tasks ?? [])) {
    updateTask(t.id, { status: 'pending', attempts: 0 })
  }
  if (opts?.raiseBudget) {
    const spent = run.spent
    // lift the run cap above what's already spent so the loop can proceed
    updateCollabRun(runId, { status: 'running', reason: '', spent })
    // budget itself is stored per-run; raising it: add headroom to maxRuns
    const db = getCollabRunBare(runId)!
    const newBudget = { ...db.budget, maxRuns: Math.max(db.budget.maxRuns, spent.runs) + 12 }
    // persist budget via a direct repo write
    setBudget(runId, newBudget)
  } else {
    updateCollabRun(runId, { status: 'running', reason: '' })
  }
  emitChanged(runId)
  step(runId)
  return getCollabRun(runId)
}

// small helper to persist a raised budget without widening the repo patch surface
// ── execution loop ─────────────────────────────────────────────────────────────
function step(runId: string): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  if (run.spent.runs >= run.budget.maxRuns) {
    updateCollabRun(runId, { status: 'needs_attention', reason: `Budget reached (${run.budget.maxRuns} agent runs). Resume to continue.` }); emitChanged(runId); return
  }
  const tasks = run.tasks ?? []
  const pending = tasks.filter((t) => t.status === 'pending')
  if (pending.length === 0) { finalize(runId); return }
  const runnable = nextRunnable(tasks)
  if (!runnable) {
    // Everything left waits on work that did not pass (explicit dependency, or a
    // review waiting on earlier tasks). Resume retries the failed tasks.
    const failed = tasks.filter((t) => t.status === 'failed').map((t) => `“${t.title}”`)
    pause(runId, `Waiting on ${failed.length ? failed.join(', ') : 'a task that did not pass'}. Fix it from the task below, or Resume to retry ${failed.length === 1 ? 'it' : 'them'}.`)
    return
  }
  if (runnable.kind === 'review') runReviewer(runId, runnable.id, false)
  else runMaker(runId, runnable.id)
}

function runMaker(runId: string, taskId: string): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  const sender = claimFor(run); if (!sender) return
  const task = getTask(taskId); if (!task) { pause(runId, 'A task in this run could not be found. Resume to carry on.'); return }   // P0-1: unlocks
  // A task assigned to an agent that has since been turned off runs on the run's own agent (D-071).
  const makerProvider = makerProviderOf(run, task)
  // D-121: fingerprint the outputs before this attempt, to catch "says done, wrote nothing".
  ensureOutputDirs(run, task)
  makerSnaps.set(taskId, snapshot(run.projectCwd))   // D-128: what the project looked like before
  updateTask(taskId, { status: 'in_progress', attempts: task.attempts + 1, meta: { ...task.meta, startHash: outputsHash(run, task), tries: startTry(task, makerProvider) } })
  emitChanged(runId)
  const retry = task.lastVerdict?.verdict === 'FAIL'
  // D-127: an agent that can't open files gets its inputs pasted; one that can't CHANGE files
  // (text-only, or any agent in a Read-only run) returns its files in the reply and Troupe saves them.
  const cannotRead = !canWriteFiles(makerProvider)
  const textOnly = replyFiles(run, makerProvider)
  const outputs = scopePaths(task.scope).outputs
  const prompt = [
    `You are the Maker for this Collab task.`, '',
    // D-121: the goal for context. If it disagrees with this task, say so instead of guessing.
    `**Run goal (context):** ${run.goal}`,
    `**Task:** ${task.title}`,
    task.scope ? `**Scope (only touch this):** ${task.scope}` : '',
    task.acceptance ? `**Acceptance criteria:** ${task.acceptance}` : '',
    run.outputDir && !textOnly ? `**Deliverables folder:** \`${run.outputDir}/\` — put what you produce there (Troupe has created it and the folders your files go in), never under \`.workbench/\`.` : '',
    cannotRead ? inlineInputs(run, task) : completedContext(run),
    textOnly && !cannotRead ? 'This run is Read-only: you can open and read project files, but not change them or run commands. Put each deliverable in your reply as shown below; Troupe saves it.' : '',
    planChangesContext(run, task.id),
    task.meta.note ? `\n**Note from the user — follow it, it overrides earlier instructions:** ${task.meta.note}` : '',
    'If the goal and this task\'s acceptance criteria contradict each other, do not pick one silently: follow the acceptance criteria and explain the conflict in your handoff ("status": "blocked" if you cannot satisfy both).',
    retry ? `\nThis is a retry. The reviewer's findings to address:\n${(task.lastVerdict?.findings ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
    textOnly ? textMakerContract(outputs.filter((p) => !p.endsWith('/'))) : makerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  // D-064: the run model only applies to the run's own provider (Codex was handed "opus").
  const makerModel = resolveTaskModel(run.providerId, run.model, makerProvider, makerProvider === task.provider ? task.model : null, modelLists(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING)))
  const rid = launchRole(run, sender, {
    role: 'maker', group: 'maker', task, label: 'Maker', retry,
    params: { providerId: makerProvider, model: makerModel || undefined, prompt, permissionMode: run.permissionMode, skillIds: [SK_PROTOCOL, SK_MAKER] },
    onDone: (mid, err) => onMakerDone(runId, taskId, mid, err)
  })
  if (rid) updateTask(taskId, { makerRunId: rid })
}

function onMakerDone(runId: string, taskId: string, messageId: string | null, err?: string): void {
  const run = getCollabRunBare(runId); if (!run || run.status !== 'running') return
  // D-121: an agent error ends the try too (test 6 showed "Grok in progress" on a failed task).
  if (err) { endTry(taskId, 'failed', `${providerLabel(makerProviderOf(run, getTask(taskId)!), 'agent')} errored: ${err}`); updateTask(taskId, { status: 'failed' }); pause(runId, `A Maker run errored on “${getTask(taskId)?.title ?? 'a task'}”: ${err}. Resume retries it.`); return }
  const reply = messageId ? getMessage(messageId)?.content ?? '' : ''
  if (messageId) {
    const h = extractJson<CollabHandoff>(reply)
    if (h) {
      const files = Array.isArray(h.filesChanged) ? h.filesChanged : []
      updateTask(taskId, { handoff: { status: h.status || 'done', filesChanged: files, verify: h.verify || '' } })
      // The app keeps STATUS.md (agents may not be able to write it: read-only runs, Zoey 2026-10-20).
      const t = getTask(taskId)
      appendStatus(run, `## ${today()} · Maker (${providerLabelOf(makerProviderOf(run, t!))}) · ${t?.title ?? 'task'} — ${h.status || 'done'}\n\n- Files: ${files.length ? files.map((f) => `\`${f}\``).join(', ') : '(none noted)'}${h.verify ? `\n- To check: ${h.verify}` : ''}\n\n---`)
    }
  }
  // D-121: the agent stopped at a permission prompt it can't get answered in a background run.
  // Say exactly that (not "deliverable missing"), and go to the Planner: retrying the same
  // agent unchanged hits the same prompt.
  const blocked = PERMISSION_BLOCKED_RE.exec(reply)
  const bt = getTask(taskId)
  if (blocked && bt?.kind === 'work') {
    const who = providerLabel(makerProviderOf(run, bt), makerProviderOf(run, bt))
    // D-127: a tool nobody in this run may use is the run's limit, not this agent's — handing the
    // task to another agent hits the same wall (Read-only test, 2026-10-20: Claude → Grok → Claude).
    if (runLimited(run, bt, needOfTool(blocked[1]), `${who} stopped asking permission for \`${blocked[1]}\``)) return
    const finding = `${who} was blocked asking permission for ${blocked[1]}: a background run can't answer a permission prompt, so it stopped before finishing. Retrying ${who} unchanged will stop at the same prompt — give the task to another agent, or change it so it doesn't need ${blocked[1]}.`
    appendStatus(run, `## ${today()} · App · ${bt.title} — ${who} blocked at a permission prompt (${blocked[1]})\n\n---`)
    onTaskFailed(runId, taskId, { verdict: 'FAIL', findings: [finding] }, `${who} was blocked asking permission for ${blocked[1]} on “${bt.title}”.`, { stuck: `blocked asking permission for ${blocked[1]}` })
    return
  }
  // D-127: a Maker blocked by the run's own limits (Read-only, a Tools setting) — before the
  // deliverables check, which would otherwise retry it for a missing file it was never allowed to make.
  if (bt?.kind === 'work' && bt.handoff?.status?.toLowerCase() === 'blocked' &&
    runLimited(run, bt, needOfText(bt.handoff.verify || ''), `${providerLabel(makerProviderOf(run, bt), makerProviderOf(run, bt))} reported it is blocked: ${bt.handoff.verify || 'no reason given'}`)) return
  if (!deliverablesGate(run, taskId, reply)) return
  // D-111: a Maker that says it is blocked won't be helped by a review or a plain retry —
  // go straight to the Planner (no Reviewer run spent).
  const t = getTask(taskId)
  if (t?.kind === 'work' && t.handoff?.status?.toLowerCase() === 'blocked') {
    const why = t.handoff.verify || 'no reason given'
    appendStatus(run, `## ${today()} · App · ${t.title} — the Maker reported it is blocked: ${why}\n\n---`)
    onTaskFailed(runId, taskId, { verdict: 'FAIL', findings: [`The Maker reported it is blocked: ${why}`] }, `“${t.title}” is blocked.`, { stuck: 'the Maker reported it is blocked' })
    return
  }
  // D-121: compare the claim with the files. A Maker that reports done but left every output
  // exactly as it was before this attempt fails now — no Reviewer run spent on unchanged work.
  // Only on a first attempt or after a real Reviewer FAIL: after any other failure (the review
  // couldn't be done, or this same check), leaving the file as it is can be correct (test 7).
  if (t?.kind === 'work' && t.meta.startHash && !replyFiles(run, makerProviderOf(run, t)) && (t.meta.lastFailKind === 'review' || (t.attempts <= 1 && !t.lastVerdict))) {
    const outs = scopePaths(t.scope).outputs
    if (outs.length && outputsHash(run, t) === t.meta.startHash) {
      const files = outs.map((p) => `\`${p}\``).join(', ')
      const findings = [`No changes were written: ${files} ${outs.length === 1 ? 'is' : 'are'} exactly as before this attempt, although the reply says the work is done. Make the changes in ${outs.length === 1 ? 'the file itself' : 'the files themselves'}.`]
      appendStatus(run, `## ${today()} · App check · task ${t.seq + 1} — ${t.title} · FAIL\n\n1. ${findings[0]}\n\n---`)
      updateTask(taskId, { meta: { ...t.meta, lastFailKind: 'unchanged' } })
      onTaskFailed(runId, taskId, { verdict: 'FAIL', findings }, `“${t.title}” was reported done but ${files} didn't change.`)
      return
    }
  }
  if (t?.kind === 'work') recordAttempt(run, t)
  runReviewer(runId, taskId, false)
}

// D-108: before a Reviewer run, check the task's output files exist. A text-only Maker's
// files are saved from its reply first. Missing files go straight back to the Maker (no
// Reviewer run spent); after the retries, the run pauses with the reason. Returns true to review.
function deliverablesGate(run: CollabRun, taskId: string, reply: string): boolean {
  const task = getTask(taskId); if (!task || task.kind !== 'work') return true
  const outputs = scopePaths(task.scope).outputs
  if (!outputs.length) return true
  const probe = probeIn(run.projectCwd)
  let missing = missingOutputs(outputs, probe)
  const maker = makerProviderOf(run, task)
  const who = providerLabel(maker, maker)
  if (replyFiles(run, maker)) {
    // Every output the reply carries in a FILE block is saved (in a Read-only run that includes
    // existing files the task edits); with no blocks, the whole reply only fills a MISSING file.
    const saved: string[] = []
    for (const f of filesFromReply(reply, reply.includes(FILE_BLOCK_START) ? outputs : missing)) {
      try {
        const abs = ensureInside(run.projectCwd, f.path)
        mkdirSync(join(abs, '..'), { recursive: true }); writeFileSync(abs, f.content, 'utf8'); saved.push(f.path)
      } catch (e) { logError(`[collab] could not save ${f.path} from reply: ${String(e)}`) }
    }
    if (saved.length) {
      const h = task.handoff
      updateTask(taskId, { handoff: { status: h?.status || 'done', filesChanged: [...new Set([...(h?.filesChanged ?? []), ...saved])], verify: h?.verify || '' } })
      appendStatus(run, `## ${today()} · App · ${task.title} — saved ${saved.map((p) => `\`${p}\``).join(', ')} from ${who}'s reply (${canWriteFiles(maker) ? 'Read-only run' : 'text-only agent'})\n\n---`)
      missing = missingOutputs(outputs, probe)
    }
  }
  if (!missing.length) return true
  const findings = missing.map((p) => `Deliverable missing: \`${p}\` ${p.endsWith('/') ? 'has no files' : 'was not written'} (checked by the app before review). Write it${!replyFiles(run, maker) ? '' : ` — reply with it in a "=== FILE: ${p} ===" block`}.`)
  appendStatus(run, `## ${today()} · App check · task ${task.seq + 1} — ${task.title} · FAIL\n\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n---`)
  onTaskFailed(run.id, taskId, { verdict: 'FAIL', findings }, `${who} didn't produce ${missing.map((p) => `“${p}”`).join(', ')} after ${task.attempts} tries on “${task.title}”.`)
  return false
}

// ── failure handling, stall detection, recovery (D-109) ─────────────────────
// Every FAIL (app check or Reviewer) comes here. A work task with retries left goes
// back to its Maker — unless it failed the same way again, which means retrying
// unchanged won't help: then the Planner is asked for a repair. Otherwise the run
// pauses and the card offers: retry with a note, reassign, skip, or ask the Planner.
/**
 * D-127: the task needs something no agent in this run has (write, shell, web) — because of the
 * run's mode or a Tools setting. The Planner can't fix that by changing agents, so Troupe pauses
 * with its own fix: switch the run to Auto (when that would give someone the ability), or turn the
 * setting on and retry, or skip. Raising permissions always waits for the user's click.
 */

function runReviewer(runId: string, taskId: string, _isFinal: boolean): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  const sender = claimFor(run); if (!sender) return
  const task = getTask(taskId); if (!task) { pause(runId, 'A task in this run could not be found. Resume to carry on.'); return }   // P0-1: unlocks
  if (task.kind === 'review') updateTask(taskId, { status: 'in_progress', attempts: task.attempts + 1 })
  emitChanged(runId)
  const isWholeGoal = task.kind === 'review'
  const h = task.handoff
  const handoffLine = h
    ? `**The Maker reports:** ${h.status} · files: ${h.filesChanged?.length ? h.filesChanged.join(', ') : '(none noted)'}${h.verify ? ` · verify by: ${h.verify}` : ''}`
    : ''
  const prompt = [
    `You are the Reviewer (read-only QC) for this Collab ${isWholeGoal ? 'run' : 'task'}.`, '',
    isWholeGoal
      ? `Check the whole result against the goal: ${run.goal}`
      : `**Task:** ${task.title}`,
    !isWholeGoal && task.acceptance ? `**Acceptance criteria:** ${task.acceptance}` : '',
    isWholeGoal ? completedContext(run) : handoffLine,
    // D-128: Troupe's record — facts, so the review is about the work, not about proving its history.
    !isWholeGoal && task.meta.recorded ? ['', '## What Troupe recorded for this attempt (facts — no need to verify them)', recordText(task)].join('\n') : '',
    planChangesContext(run, isWholeGoal ? null : task.id),
    'Open the files named above and verify against the acceptance criteria. Do not read the full status log.',
    readHint(reviewerOf(run, task)),
    reviewerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  const reviewer = reviewerOf(run, task)
  const rid = launchRole(run, sender, {
    role: 'reviewer', group: 'reviewer', task, label: 'Reviewer', retry: task.kind === 'work' && task.attempts > 1,
    // Read-only on files, but allowed to search and fetch the web so it can verify
    // sources and URLs itself (D-064: several reviews failed for lack of it).
    params: { providerId: reviewer, prompt, permissionMode: 'read', allowWeb: true, model: strongModel(reviewer) || undefined, skillIds: [SK_PROTOCOL, SK_REVIEWER] },
    onDone: (mid, err) => onReviewerDone(runId, taskId, mid, err)
  })
  updateTask(taskId, { reviewerRunId: rid })
}

function onReviewerDone(runId: string, taskId: string, messageId: string | null, err?: string): void {
  const run = getCollabRunBare(runId); if (!run || run.status !== 'running') return
  const task = getTask(taskId); if (!task) return
  if (err || !messageId) { updateTask(taskId, { status: 'failed' }); pause(runId, `A Reviewer run errored on “${task.title}”: ${err || 'no output'}. Resume retries it.`); return }
  const text = getMessage(messageId)?.content ?? ''
  const raw = extractJson<{ verdict?: string; findings?: unknown[] }>(text)
  const rawFindings = (Array.isArray(raw?.findings) ? raw!.findings : []).map(findingToText)
  // D-121 (test 7): the Reviewer couldn't check the work at all (Codex said it couldn't read the
  // files). That is not a defect in the work: don't send it back to the Maker — give the review
  // to another agent.
  if (raw?.verdict === 'BLOCKED' || (raw?.verdict === 'FAIL' && reviewerCouldNotCheck(rawFindings))) {
    reviewBlocked(runId, taskId, rawFindings)
    return
  }
  let verdict = raw as CollabVerdict | null
  if (!verdict || (verdict.verdict !== 'PASS' && verdict.verdict !== 'FAIL')) {
    verdict = { verdict: 'FAIL', findings: ['Reviewer output could not be parsed as a PASS/FAIL verdict.'] }
  }
  verdict.findings = (Array.isArray(verdict.findings) ? verdict.findings : []).map(findingToText)
  updateTask(taskId, { lastVerdict: verdict })
  {
    const rn = getCollabRunBare(runId)
    if (rn) {
      const kindWord = task.kind === 'review' ? 'whole-result review' : `task ${task.seq + 1}`
      const findings = verdict.findings.length
        ? verdict.findings.map((f, i) => `${i + 1}. ${f}`).join('\n')
        : (verdict.verdict === 'PASS' ? 'No blocking issues.' : 'No findings given.')
      appendStatus(rn, `## ${today()} · Reviewer (${providerLabelOf(reviewerOf(rn, task))}) · ${kindWord} — ${task.title} · ${verdict.verdict}\n\n${findings}\n\n---`)
    }
  }
  if (verdict.verdict === 'PASS') {
    if (task.kind === 'work') { endTry(taskId, 'passed'); task.meta = getTask(taskId)?.meta ?? task.meta }
    updateTask(taskId, { status: 'passed', meta: { ...task.meta, note: undefined, sig: undefined, sameFails: 0 } })
    emitChanged(runId)
    step(runId)
    return
  }
  // FAIL — retry, ask the Planner for a repair, or pause for the user (D-109).
  { const tf = getTask(taskId); if (tf) updateTask(taskId, { meta: { ...tf.meta, lastFailKind: 'review' } }) }
  onTaskFailed(runId, taskId, verdict, task.kind === 'review' ? `The final review didn't pass.` : `“${task.title}” failed review after retries.`)
}

/** How this reviewer reads files in a read-only run (D-121: Codex refused to use its shell). */

function countsSummary(run: CollabRun, stopped = false): string {
  const tasks = run.tasks ?? []
  const passed = tasks.filter((t) => t.status === 'passed').length
  const failed = tasks.filter((t) => t.status === 'failed')
  const skipped = tasks.filter((t) => t.status === 'skipped')
  const took = tasks.filter((t) => t.kind === 'work' && t.meta.tries?.at(-1)?.result === 'passed' && new Set((t.meta.tries ?? []).map((x) => x.agent)).size > 1)
    .map((t) => `${TASK_NUM(t)} done by ${providerLabelOf((t.meta.tries ?? []).at(-1)!.agent)} after ${(t.meta.tries ?? []).length - 1} failed ${(t.meta.tries ?? []).length === 2 ? 'try' : 'tries'}`)
  return [
    stopped ? `Stopped with ${passed}/${tasks.length} tasks passed` : failed.length ? `Completed ${passed}/${tasks.length} — ${failed.length} task(s) did not pass: ${failed.map((t) => t.title).join(', ')}` : `Completed ${passed}/${tasks.length} tasks`,
    skipped.length ? `skipped: ${skipped.map((t) => `“${t.title}”`).join(', ')}` : '',
    ...took
  ].filter(Boolean).join(' · ')
}

function finalize(runId: string): void {
  const run = getCollabRun(runId); if (!run) return
  forgetSnaps(run)
  const failed = (run.tasks ?? []).filter((t) => t.status === 'failed')
  // D-121: skipped tasks are part of the result (a run that skipped its final review used to
  // read "done" with no mention of it).
  const summary = countsSummary(run)
  const mark = failed.length ? '⚠️ Collab run finished with unresolved tasks.' : '✅ Collab run complete.'
  appendStatus(run, `\n---\n${mark} ${summary}`)
  // D-064: a run with unresolved tasks is not "done" — it waits for Resume (retry) or Stop.
  if (failed.length) {
    updateCollabRun(runId, { status: 'needs_attention', summary, reason: `${summary}. Resume retries ${failed.length === 1 ? 'it' : 'them'}; Stop ends the run.` })
    unlockFor(run, 'waiting'); emitChanged(runId)
    return
  }
  // D-121: every finished run ends with the Planner's wrap-up — outcome, files, decisions for
  // the user, follow-ups — shown in the chat and on the Done card.
  updateCollabRun(runId, { summary, reason: 'Writing the wrap-up…' })
  emitChanged(runId)
  if (!runWrapUp(runId, 'done')) {
    updateCollabRun(runId, { status: 'done', reason: '' })
    unlockFor(run); emitChanged(runId)
  }
  logInfo(`[collab] done: ${summary}`)
}

// ── wrap-up (D-121) ──────────────────────────────────────────────────────────
const wrapUps = new Map<string, string>()   // runId → wrap-up agent run id in flight

function runWrapUp(runId: string, ending: 'done' | 'stopped'): boolean {
  const run = getCollabRun(runId); if (!run) return false
  // Not claimFor(): a wrap-up that can't start doesn't pause the run — the caller ends it.
  if (!lockFor(run)) return false
  const sender = wc(runId); if (!sender) return false   // the caller releases the lock with the run's outcome
  const rid = launchRole(run, sender, {
    role: 'wrapup', group: 'planner', label: 'wrap-up', track: ending === 'done', guard: false,
    params: { providerId: run.providerId, prompt: wrapUpPrompt(run, ending), permissionMode: 'read', model: strongModel(run.providerId) || undefined, skillIds: [SK_PROTOCOL, SK_PLANNER] },
    onDone: (mid, err) => {
      try { onWrapUpDone(runId, ending, mid, err) } catch (e) {
        logError('[collab] wrap-up handling failed', { run: runId, err: String((e as Error)?.stack ?? e) })
        const r = getCollabRunBare(runId); if (r) unlockFor(r, ending === 'stopped' ? 'stopped' : 'done')
        emitChanged(runId)
      }
    }
  })
  if (!rid) return false
  wrapUps.set(runId, rid)
  return true
}

function onWrapUpDone(runId: string, ending: 'done' | 'stopped', messageId: string | null, err?: string): void {
  wrapUps.delete(runId)
  const run = getCollabRunBare(runId); if (!run) return
  const text = !err && messageId ? getMessage(messageId)?.content ?? '' : ''
  // D-121: the card keeps the app's plain one-liner (the wrap-up's own text, with its markdown,
  // is right above it in the chat); it only says how many decisions the wrap-up leaves you.
  const decisions = text ? parseWrapUp(text).decisions.length : 0
  const tail = decisions ? ` · ${decisions === 1 ? '1 decision' : `${decisions} decisions`} for you in the wrap-up` : ''
  if (text) appendStatus(run, `## ${today()} · Planner · wrap-up\n\n${text.trim()}\n\n---`)
  else logError(`[collab] wrap-up failed: ${err ?? 'no output'}`)
  if (ending === 'done' && run.status === 'running') {
    updateCollabRun(runId, { status: 'done', reason: '', summary: (run.summary || countsSummary(getCollabRun(runId)!)) + tail })
  } else if (run.status === 'stopped') {
    updateCollabRun(runId, { reason: 'Stopped by you.', summary: countsSummary(getCollabRun(runId)!, true) + tail })
  }
  unlockFor(run, ending === 'stopped' ? 'stopped' : 'done')
  emitChanged(runId)
}

// recovery.ts calls back into the loop through `loop` (runtime.ts); recovery actions are part of
// this module's public API, as before the split.
loop.step = step
loop.runMaker = runMaker
loop.runReviewer = runReviewer
export { recoverTask, applyRepair, setCollabMode, reviewerCouldNotCheck } from './recovery'
