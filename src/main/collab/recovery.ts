// Failure handling, stall detection, Planner repair and recovery actions (D-109, D-127). Split
// out of orchestrator.ts (audit #12); it calls back into the loop through `loop` (runtime.ts).
import { type WebContents } from 'electron'
import { join } from 'path'
import { getMessage } from '../conversations/messagesRepo'
import type { CollabRun, CollabTask, CollabVerdict, ProviderId, CollabRecoverAction, CollabRepairOption, CollabTaskMeta } from '../../shared/types'
import { failSig, nextSameFails, parseRepair, STALL_AFTER } from '../../shared/collabRecovery'
import { getCollabRun, getCollabRunBare, updateCollabRun, getTask, updateTask, setRunPermission } from './collabRepo'
import { extractJson } from './parse'
import { runBlocker, NEED_WORD, type Need } from '../../shared/collabAbilities'
import { getSetting } from '../database/settingsRepo'
import { isProviderId, providerLabel, enabledProviderIds, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { abilitiesOf, abilityOf, addHistory, agentsForPlanner, canWriteFiles, enabledAgents, endTry, handoverMeta, makerProviderOf, providerLabelOf, reviewerOf, strongModel } from './agents'
import { repairContract } from './prompts'
import { TASK_NUM, appendStatus, outputState, outputsHash, relRunDir, writePlanMd } from './runFiles'
import { loop, claimFor, launchRole, SK_PLANNER, SK_PROTOCOL, emitChanged, pause, senderFor, today } from './runtime'

export function runLimited(run: CollabRun, task: CollabTask, need: Need | null, what: string): boolean {
  if (!need) return false
  const ids = enabledAgents()
  const block = runBlocker(need, ids.map((id) => abilityOf(run, id)), ids.map((id) => abilityOf(run, id, 'auto')))
  if (!block) return false
  endTry(task.id, 'blocked', what)
  updateTask(task.id, { status: 'failed', lastVerdict: { verdict: 'FAIL', findings: [what] } })
  const readOnly = run.permissionMode === 'read'
  const settingStep = need === 'shell' ? 'Turn on Shell commands in Settings ▸ Tools' : need === 'web' ? 'Turn on Web access in Settings ▸ Tools' : ''
  const options: CollabRepairOption[] = []
  if (readOnly && block.mode) options.push({ label: 'Switch run to Auto, retry', action: 'mode', mode: 'auto', changesGoal: false })
  else if (settingStep) options.push({ label: 'Retry after the setting', action: 'retry', changesGoal: false, userStep: settingStep })
  options.push({ label: 'Skip this task', action: 'skip', changesGoal: true, note: `Skipped: no agent in this run can ${NEED_WORD[need]}.` })
  const summary = `No agent in this ${readOnly ? 'Read-only' : ''} run can ${NEED_WORD[need]}, so another agent would hit the same limit.`.replace('this  run', 'this run')
  appendStatus(run, `## ${today()} · App · ${task.title} — ${what}. ${summary}\n\n---`)
  updateCollabRun(run.id, { repair: { taskId: task.id, summary, options, recommended: 0 } })
  pause(run.id, `“${task.title}” needs to ${NEED_WORD[need]}, which this run doesn't allow${readOnly ? ' (it is Read-only)' : ''}. Pick a fix below.`)
  return true
}

export function onTaskFailed(runId: string, taskId: string, verdict: CollabVerdict, pausedWhy: string, opts?: { stuck?: string }): void {
  const task = getTask(taskId); if (!task) return
  const run0 = getCollabRunBare(runId); if (!run0) return
  // "Stuck" (D-111): the Maker says it's blocked, or the same failure came back (findings
  // compared by overlap, not exact words), or the output files didn't change since the
  // last failure. Retrying unchanged won't help any of these.
  if (task.kind === 'work') { endTry(taskId, opts?.stuck && /blocked/.test(opts.stuck) ? 'blocked' : 'failed', verdict.findings[0]); task.meta = getTask(taskId)?.meta ?? task.meta }
  const sig = failSig(verdict.findings)
  const sameFails = nextSameFails(task.meta.sig, task.meta.sameFails, sig)
  const outHash = task.kind === 'work' ? outputsHash(run0, task) : undefined
  const unchanged = !!outHash && !!task.meta.outHash && outHash === task.meta.outHash
  updateTask(taskId, { lastVerdict: verdict, meta: { ...task.meta, sig, sameFails, outHash } })
  // D-121: after an automatic Planner fix, the same failure once more is enough — the fix
  // didn't help, so ask the user now instead of spending two more attempts finding out.
  const fixDidntHelp = !!task.meta.repairSig && nextSameFails(task.meta.repairSig, 1, sig) >= 2
  const stuck = task.kind === 'work'
    ? (opts?.stuck ?? (fixDidntHelp ? 'failed the same way again after the Planner\'s fix' : sameFails >= STALL_AFTER ? `failed the same way ${sameFails} times in a row` : unchanged ? 'failed again with its files unchanged' : null))
    : null
  if (stuck) {
    updateTask(taskId, { status: 'failed' })
    appendStatus(run0, `## ${today()} · App · ${task.title} — stuck: ${stuck}. Asking the Planner for a fix instead of retrying unchanged.\n\n---`)
    startRepair(runId, taskId, { auto: true })
    return
  }
  const fresh = getCollabRunBare(runId)!
  if (task.kind === 'work' && task.attempts <= fresh.budget.maxRetriesPerTask) { loop.runMaker(runId, taskId); return }
  updateTask(taskId, { status: 'failed' })
  // D-121: a failed whole-result review always comes with fixes (it used to just pause):
  // the Planner proposes which work task to redo, and the user picks.
  if (task.kind === 'review') {
    appendStatus(fresh, `## ${today()} · App · ${task.title} — the final review failed. Asking the Planner which work to redo.\n\n---`)
    startRepair(runId, taskId, { auto: false })
    return
  }
  pause(runId, `${pausedWhy} Fix it from the task below — retry with a note, give it to another agent, skip it, or ask the Planner — or Stop the run.`)
}

// What changed in the plan since it was confirmed (skips, reassignments, rewrites),
// so Makers and Reviewers work from the current plan, not the original one.
export function planChangesContext(run: CollabRun, forTaskId: string | null): string {
  const tasks = run.tasks ?? []
  const lines: string[] = []
  for (const t of tasks) {
    if (t.status === 'skipped') lines.push(`- ${TASK_NUM(t)} “${t.title}” was SKIPPED${t.meta.skipNote ? `: ${t.meta.skipNote}` : ''}. Do not expect its output; work without it.`)
    else if (t.meta.history?.length && (forTaskId === null || t.id === forTaskId || tasks.find((x) => x.id === forTaskId)?.dependsOn.includes(t.id))) {
      lines.push(...t.meta.history.map((h) => `- ${TASK_NUM(t)} “${t.title}”: ${h}`))
    }
  }
  return lines.length ? ['## Plan changes since it was confirmed (decided by the user or the Planner)', ...lines,
    'Judge the work against the plan as changed — not against requirements that were dropped here.'].join('\n') : ''
}

function resumeAfterChange(runId: string): void {
  const run = getCollabRun(runId); if (!run) return
  writePlanMd(run, run.tasks ?? [])
  updateCollabRun(runId, { status: 'running', reason: '', repair: null })
  emitChanged(runId)
  loop.step(runId)
}

/** The user's fix for a failed task on a paused run (card buttons). */

export function recoverTask(sender: WebContents, runId: string, taskId: string, action: CollabRecoverAction): CollabRun | null {
  const run = getCollabRun(runId); if (!run) return null
  senderFor.set(runId, sender)
  if (run.status !== 'needs_attention') return run
  const task = getTask(taskId); if (!task || task.runId !== runId) return run
  const note = action.note?.trim() || undefined
  if (action.type === 'repair') { startRepair(runId, taskId, { auto: false, note }); return getCollabRun(runId) }
  if (action.type === 'skip') {
    updateTask(taskId, { status: 'skipped', meta: addHistory({ ...task.meta, skipNote: note }, `skipped by the user${note ? ` — ${note}` : ''}`) })
    appendStatus(run, `## ${today()} · You · ${task.title} — skipped${note ? `: ${note}` : ''}\n\n---`)
  } else if (action.type === 'reassign') {
    if (!enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(action.provider)) return run
    const who = providerLabel(action.provider, action.provider)
    updateTask(taskId, { status: 'pending', attempts: 0, provider: action.provider, model: null,
      meta: handoverMeta(run, task, addHistory({ ...task.meta, note, sig: undefined, sameFails: 0, outHash: undefined }, `reassigned to ${who} by you`), action.provider) })
    appendStatus(run, `## ${today()} · You · ${task.title} — given to ${who}${note ? `, with a note: ${note}` : ''}\n\n---`)
  } else {
    // retry — with a note it counts as new information, so the stall count restarts
    updateTask(taskId, { status: 'pending', attempts: 0, meta: note ? { ...task.meta, note, sig: undefined, sameFails: 0, outHash: undefined } : task.meta })
    appendStatus(run, `## ${today()} · You · ${task.title} — retry${note ? ` with a note: ${note}` : ''}\n\n---`)
  }
  resumeAfterChange(runId)
  return getCollabRun(runId)
}

function startRepair(runId: string, taskId: string, opts: { auto: boolean; note?: string }): void {
  const run = getCollabRun(runId); if (!run) return
  const task = getTask(taskId); if (!task) return
  const sender = claimFor(run); if (!sender) return
  if (run.spent.runs >= run.budget.maxRuns) { pause(runId, `Budget reached (${run.budget.maxRuns} agent runs) while “${task.title}” needs a fix. Raise the budget, or fix the task yourself below.`); return }
  updateCollabRun(runId, { status: 'running', reason: `Asking the Planner how to fix “${task.title}”…`, repair: null })
  emitChanged(runId)
  const tasks = run.tasks ?? []
  const maker = makerProviderOf(run, task)
  const dependents = tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => `${TASK_NUM(t)} “${t.title}”`)
  const prompt = [
    `You are the Planner for a Collab run, asked to REPAIR one task that keeps failing. Goal:`, '', run.goal, '',
    `The plan is in \`${relRunDir(run)}/PLAN.md\`; recent history is at the end of \`${relRunDir(run)}/STATUS.md\` (read only the last entries).`,
    '', '## Plan status',
    ...tasks.map((t) => `- ${TASK_NUM(t)} “${t.title}” — ${t.status}${t.provider ? ` · ${t.provider}` : ''}`),
    '', `## The failing task: ${TASK_NUM(task)} “${task.title}”`,
    `- Agent: "${maker}" (in this run: ${abilitiesOf(run, maker)})`,
    task.scope ? `- Scope: ${task.scope}` : '',
    task.acceptance ? `- Acceptance: ${task.acceptance}` : '',
    `- Attempts: ${task.attempts}${task.meta.sameFails ? ` · same failure ${task.meta.sameFails} times in a row` : ''}`,
    dependents.length ? `- Later tasks that need it: ${dependents.join(', ')}` : '- No later task depends on it directly.',
    '', '## Latest findings', ...(task.lastVerdict?.findings ?? ['(none)']).map((f, i) => `${i + 1}. ${f}`),
    ...outputState(run, task),
    opts.note ? `\n## The user says\n${opts.note}` : '',
    '', agentsForPlanner(run),
    repairContract(task.kind === 'review')
  ].filter((l) => l !== '').join('\n')
  launchRole(run, sender, {
    role: 'repair', group: 'planner', task, label: 'repair run', retry: true,
    params: { providerId: run.providerId, prompt, permissionMode: 'read', model: strongModel(run.providerId) || undefined, skillIds: [SK_PROTOCOL, SK_PLANNER] },
    onDone: (mid, err) => onRepairDone(runId, taskId, mid, err, opts.auto)
  })
}

function onRepairDone(runId: string, taskId: string, messageId: string | null, err: string | undefined, auto: boolean): void {
  const run = getCollabRunBare(runId); if (!run || run.status !== 'running') return
  const task = getTask(taskId); if (!task) return
  const enabled = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING))
  const plan = getCollabRun(runId)?.tasks ?? []
  const isWork = (seq: number) => plan[seq]?.kind === 'work'
  const repair = err || !messageId ? null : parseRepair(extractJson<unknown>(getMessage(messageId)?.content ?? ''), taskId, (id) => enabled.includes(id as ProviderId), isWork)
  if (!repair) {
    pause(runId, `The Planner couldn't suggest a fix for “${task.title}”${err ? ` (${err})` : ''}. Fix it from the task below, or Stop the run.`)
    return
  }
  appendStatus(run, `## ${today()} · Planner · repair for ${task.title}\n\n${repair.summary}\n\n${repair.options.map((o, i) => `${i + 1}. ${o.label}${o.changesGoal ? ' (changes the goal)' : ''}`).join('\n')}\n\n---`)
  const best = repair.options[repair.recommended]
  // Applied without asking only when it keeps the goal intact, and only once per task.
  // Never when the user has to do something first (userStep).
  if (auto && best && !best.changesGoal && !best.userStep && (task.meta.repairs ?? 0) < 1) {
    applyRepairOption(runId, taskId, best, 'the Planner')
    return
  }
  updateCollabRun(runId, { repair })
  pause(runId, task.kind === 'review'
    ? `The final review didn't pass. Pick one of the Planner’s fixes, or fix it yourself from the task below.`
    : `“${task.title}” keeps failing the same way. Pick one of the Planner’s fixes, or fix it yourself from the task below.`)
}

function applyRepairOption(runId: string, taskId: string, o: CollabRepairOption, by: string): void {
  const task = getTask(taskId); if (!task) return
  const run = getCollabRunBare(runId); if (!run) return
  const byPlanner = by === 'the Planner'
  // D-121: remember what an automatic fix was meant to cure; the same failure after it asks the user.
  const meta: CollabTaskMeta = { ...task.meta, repairs: (task.meta.repairs ?? 0) + (byPlanner ? 1 : 0), repairSig: byPlanner ? task.meta.sig : undefined, sig: undefined, sameFails: 0, outHash: undefined, note: o.note ?? task.meta.note }
  // D-121: a corrected goal — only ever applied by the user (the card confirms it first).
  if (o.goal && !byPlanner) {
    updateCollabRun(runId, { goal: o.goal })
    appendStatus(run, `## ${today()} · You · goal changed\n\n${o.goal}\n\n---`)
  }
  if (o.action === 'rework' && o.taskSeq !== undefined) {
    // Final review failed: redo that work task with the findings, then review the whole again.
    const target = (getCollabRun(runId)?.tasks ?? [])[o.taskSeq]
    if (target && target.kind === 'work') {
      const findings = (task.lastVerdict?.findings ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n')
      updateTask(target.id, { status: 'pending', attempts: 0, lastVerdict: { verdict: 'FAIL', findings: task.lastVerdict?.findings ?? [] },
        meta: addHistory({ ...target.meta, note: o.note ?? target.meta.note, sig: undefined, sameFails: 0, outHash: undefined, lastFailKind: 'review' }, `redone after the final review (${by}): ${o.label}`) })
      updateTask(taskId, { status: 'pending', attempts: 0, meta: addHistory(meta, `re-run after ${TASK_NUM(target)} is redone`) })
      appendStatus(run, `## ${today()} · Plan change · ${target.title} — ${o.label} (${by})\n\nFinal review findings passed to its Maker:\n${findings}\n\n---`)
      resumeAfterChange(runId)
      return
    }
  }
  if (o.action === 'mode' && o.mode === 'auto') {
    // D-127: raise the run to Auto (only ever from the user's click), then retry the task.
    if (!byPlanner) {
      setRunPermission(runId, 'auto')
      appendStatus(run, `## ${today()} · You · run switched to Auto\n\n---`)
    }
    updateTask(taskId, { status: 'pending', attempts: 0, lastVerdict: null, meta: addHistory(meta, `retried after the run was switched to Auto (${by})`) })
    resumeAfterChange(runId)
    return
  }
  if (o.action === 'skip') {
    updateTask(taskId, { status: 'skipped', meta: addHistory({ ...meta, skipNote: o.note }, `skipped (${by}): ${o.label}`) })
  } else if (o.action === 'reassign' && o.provider) {
    updateTask(taskId, { status: 'pending', attempts: 0, provider: o.provider, model: null, meta: handoverMeta(run, task, addHistory(meta, `${o.label} (${by})`), o.provider) })
  } else if (o.action === 'rewrite') {
    updateTask(taskId, {
      status: 'pending', attempts: 0, lastVerdict: null,
      ...(o.title ? { title: o.title } : {}), ...(o.scope ? { scope: o.scope } : {}), ...(o.acceptance ? { acceptance: o.acceptance } : {}),
      ...(o.provider ? { provider: o.provider, model: null } : {}),
      meta: o.provider ? handoverMeta(run, task, addHistory(meta, `rewritten (${by}): ${o.label}`), o.provider) : addHistory(meta, `rewritten (${by}): ${o.label}`)
    })
  } else {
    updateTask(taskId, { status: 'pending', attempts: 0, meta: addHistory(meta, `retry with a new instruction (${by}): ${o.label}`) })
  }
  appendStatus(run, `## ${today()} · Plan change · ${task.title} — ${o.label} (${by})${o.userStep ? `\n\nDone by the user first: ${o.userStep}` : ''}\n\n---`)
  resumeAfterChange(runId)
}

/** D-127: switch a run between Read-only and Auto before approving it, or while it's paused. Never to Full access. */

export function setCollabMode(runId: string, mode: 'read' | 'auto'): CollabRun | null {
  const run = getCollabRunBare(runId); if (!run) return null
  if (mode !== 'read' && mode !== 'auto') throw new Error('A Collab run can be switched only between Read-only and Auto.')
  if (!['awaiting_confirmation', 'needs_attention'].includes(run.status)) throw new Error('Switch the mode before running, or while the run is paused.')
  if (run.permissionMode === mode) return getCollabRun(runId)
  setRunPermission(runId, mode)
  appendStatus(run, `## ${today()} · You · run switched to ${mode === 'auto' ? 'Auto' : 'Read-only'}\n\n---`)
  emitChanged(runId)
  return getCollabRun(runId)
}

/** The user picked one of the Planner's repair options on the card. */

export function applyRepair(sender: WebContents, runId: string, index: number): CollabRun | null {
  const run = getCollabRun(runId); if (!run) return null
  senderFor.set(runId, sender)
  if (run.status !== 'needs_attention' || !run.repair) return run
  const o = run.repair.options[index]; if (!o) return run
  applyRepairOption(runId, run.repair.taskId, o, 'you')
  return getCollabRun(runId)
}

export function reviewerCouldNotCheck(findings: string[]): boolean {
  const access = /(could ?n[o']t|can ?n[o']t|cannot|unable to|was not able to|no (?:direct )?(?:local[- ]file |file[- ])?(?:read(?:ing)? )?(?:tool|access)|not (?:allowed|permitted) to (?:run|read|open)|prohibit)/i
  const fileish = /(read|open|access|view|inspect|verify|check).{0,60}(file|\.md|\.json|\.csv|folder|director|path|\b[\w-]+\.\w{1,5}\b)|tool|command/i
  return findings.length > 0 && findings.every((f) => access.test(f) && fileish.test(f))
}

/** The Reviewer couldn't check the work: move the review to another agent and run it again. */

// D-128: say what actually stopped the reviewer (the wrap-up retold every block as "couldn't open the files").
const shortReason = (r: string): string => { const one = r.replace(/\s+/g, ' ').trim(); return one.length > 140 ? one.slice(0, 137) + '…' : one }

export function reviewBlocked(runId: string, taskId: string, why: string[]): void {
  const run = getCollabRun(runId); const task = getTask(taskId); if (!run || !task) return
  const was = reviewerOf(run, task)
  const reason = why[0] ?? 'no reason given'
  const maker = task.kind === 'work' ? makerProviderOf(run, task) : null
  const tried = new Set([...(task.meta.blockedReviewers ?? []), was])
  const ok = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).filter((id) => isProviderId(id) && canWriteFiles(id) && !tried.has(id))
  const next = ok.find((id) => id !== maker) ?? ok[0]
  appendStatus(run, `## ${today()} · App · ${task.title} — ${providerLabelOf(was)} couldn't check the work: ${reason}${next ? ` Review moved to ${providerLabelOf(next)}; the Maker's work stands.` : ''}\n\n---`)
  if (!next) {
    updateTask(taskId, { meta: { ...task.meta, blockedReviewers: [...tried] } })
    pause(runId, `No agent could review “${task.title}”: ${providerLabelOf(was)} couldn't complete the review (${reason}). The work itself wasn't found faulty — skip the review, or turn on another agent in Settings ▸ Agents and Resume.`)
    return
  }
  updateTask(taskId, { meta: addHistory({ ...task.meta, reviewer: next, blockedReviewers: [...tried] }, `review moved to ${providerLabelOf(next)}: ${providerLabelOf(was)} couldn't complete the review — ${shortReason(reason)}`) })
  emitChanged(runId)
  loop.runReviewer(runId, taskId, false)
}
