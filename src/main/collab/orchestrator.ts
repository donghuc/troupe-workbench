import { BrowserWindow, type WebContents } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, appendFileSync, statSync, readdirSync, readFileSync } from 'fs'
import { IPC } from '../../shared/ipc'
import { startRun, cancelRun, runTimeoutMs } from '../agent/runner'
import { acquireLock, releaseLock } from '../agent/turns'
import { getMessage } from '../conversations/messagesRepo'
import { logInfo, logError } from '../util/logger'
import { getDb } from '../database/db'
import type { CollabRun, CollabTask, CollabTaskDraft, CollabStartInput, CollabVerdict, CollabHandoff, ProviderId, CollabRecoverAction, CollabRepairOption, CollabTaskMeta } from '../../shared/types'
import { failSig, nextSameFails, parseRepair, STALL_AFTER } from '../../shared/collabRecovery'
import {
  createCollabRun, getCollabRun, getCollabRunBare, updateCollabRun, bumpRuns,
  replaceTasks, getTask, updateTask, listCollabRuns
} from './collabRepo'
import { extractJson, findingToText } from './parse'
import { scopePaths, missingOutputs, filesFromReply, textMakerInstructions } from '../../shared/collabFiles'
import { createProvider } from '../providers/registry'
import { ensureInside } from '../filesystem/fsService'
import { nextRunnable, tasksToRetry, defaultOutputDir, sanitizeOutputDir, retargetScope } from '../../shared/collabPlan'
import { resolveTaskModel, modelForProvider, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { getSetting } from '../database/settingsRepo'
import { modelLists } from '../tools/codexModels'
import { agentEntry, isProviderId, isCustomAgentId, providerLabel, enabledProviderIds, DISABLED_AGENTS_SETTING } from '../../shared/providers'

const SK_PROTOCOL = 'global/collab-protocol'
const SK_PLANNER = 'global/role-planner'
const SK_MAKER = 'global/role-maker'
const SK_REVIEWER = 'global/role-reviewer'

// The active provider run id per collab run, so a stop can cancel it.
const activeRunId = new Map<string, string>()
// The renderer that started/confirmed a run, for streaming; falls back to first window.
const senderFor = new Map<string, WebContents>()

function wc(runId: string): WebContents | null {
  const s = senderFor.get(runId)
  if (s && !s.isDestroyed()) return s
  const w = BrowserWindow.getAllWindows()[0]
  return w ? w.webContents : null
}
// D-061: while a collab agent works, the conversation is locked like a chat turn.
const holder = (runId: string): string => `collab:${runId}`
function lockFor(run: CollabRun): boolean { return acquireLock(run.conversationId, holder(run.id)) }
function unlockFor(run: { id: string; conversationId: string }): void { releaseLock(run.conversationId, holder(run.id)) }

function emitChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(IPC.collabChanged) }
}

// ── machine I/O contracts (app-owned; NOT in the editable skills) ─────────────
function plannerContract(runDir: string, suggestedOut: string): string {
  return [
    '',
    '---',
    `Where things go: \`${runDir}/\` is the app's bookkeeping folder — only PLAN.md and STATUS.md live there. It is hidden in the app, so NEVER put deliverables under \`.workbench/\`. Choose one visible project folder for everything the tasks produce and set it as "outputDir" (suggested: \`${suggestedOut}\`; reuse an existing project folder if the goal names one). Every task's scope names paths inside outputDir (or existing project files it edits).`,
    `Write the plan to \`${runDir}/PLAN.md\` (human-readable). Then end your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    `{ "outputDir": "${suggestedOut}", "tasks": [ { "title": "...", "kind": "work", "provider": "claude-code", "model": "haiku", "scope": "files or area this task owns", "acceptance": "how anyone can tell it is done and correct", "dependsOn": [] } ] }`,
    '```',
    'Rules: kind is "work" (a Maker builds it, a Reviewer checks it) or "review" (Reviewer-only). dependsOn holds zero-based indices of earlier tasks. Include a final { "kind": "review" } task that checks the whole result against the goal. Keep tasks few and non-overlapping. If a task reads or builds on another task\'s output, it MUST list that task in dependsOn — it will not start until that task has passed review.',
    'For each WORK task, optionally set provider (one of the agents listed below) and model to fit its difficulty and cost: mechanical or read-heavy work → a cheap, fast Claude model ("haiku"); code-heavy work → "codex"; hard synthesis → a strong Claude model ("opus"); "grok" is an alternative generalist. "model" applies to Claude only — omit it for "codex" and "grok". Omit both to use the run default. Do NOT set provider/model on review tasks — planning and review always run on the run default provider automatically.'
  ].join('\n')
}
function makerContract(runDir: string): string {
  return [
    '',
    '---',
    `Append your handoff to \`${runDir}/STATUS.md\`. Then end your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    '{ "status": "done", "filesChanged": ["path", "..."], "verify": "exact steps for the reviewer to verify" }',
    '```',
    'Use "status": "blocked" if you could not complete it; put the reason in the verify field.'
  ].join('\n')
}
function textMakerContract(files: string[]): string {
  return [
    '',
    '---',
    textMakerInstructions(files),
    '',
    'Then end your reply with ONLY a fenced ```json block, no prose after it:',
    '```json',
    '{ "status": "done", "filesChanged": ["path", "..."], "verify": "exact steps for the reviewer to verify" }',
    '```',
    'Use "status": "blocked" if you could not complete it; put the reason in the verify field.'
  ].join('\n')
}
function reviewerContract(runDir: string): string {
  return [
    '',
    '---',
    `You are read-only: do not write \`${runDir}/STATUS.md\` or any other file — the app records your verdict there from the JSON below. End your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    '{ "verdict": "PASS", "findings": [] }',
    '```',
    'verdict is "PASS" only if every acceptance criterion is met with no blocking issue; otherwise "FAIL" with a numbered, specific findings list (each tied to a file or a reproduction step). You do not edit the work.'
  ].join('\n')
}

const providerLabelOf = (id: string): string => providerLabel(id, 'Claude')
// Planner + Reviewer always run on the provider's strong tier, regardless of a task's
// (possibly cheap) Maker model. Codex stays on its default until the catalog fix (backlog).
// Planner/Reviewer model; if it has been switched off (D-072) the agent's default is used.
const strongModel = (id: string): string => (isProviderId(id) ? modelForProvider(id, agentEntry(id).strongModel || undefined, {}, parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))) : '')
function today(): string { return new Date().toISOString().slice(0, 10) }

function runDirFor(run: CollabRun): string {
  return join(run.projectCwd, '.workbench', 'collab', run.id)
}
function relRunDir(run: CollabRun): string {
  return join('.workbench', 'collab', run.id)
}
const retargetTasks = (drafts: CollabTaskDraft[], runDir: string, outDir: string): CollabTaskDraft[] =>
  drafts.map((d) => ({ ...d, scope: retargetScope(d.scope ?? '', runDir, outDir), acceptance: retargetScope(d.acceptance ?? '', runDir, outDir) }))

function writePlanMd(run: CollabRun, tasks: CollabTask[]): void {
  try {
    const dir = runDirFor(run)
    mkdirSync(dir, { recursive: true })
    const lines = [
      `# Collab plan`, '', `**Goal:** ${run.goal}`, '',
      ...(run.outputDir ? [`**Deliverables folder:** \`${run.outputDir}/\``, ''] : []),
      `_Run by ${providerLabelOf(run.providerId)}. Roles are assigned automatically at run time: each **work** task is carried out by a Maker, then checked by a read-only Reviewer before it counts as done; a **review** task is Reviewer-only._`, '',
      ...tasks.map((t, i) => {
        const deps = t.dependsOn.length ? ` (depends on: ${t.dependsOn.map((d) => {
          const idx = tasks.findIndex((x) => x.id === d); return idx >= 0 ? `#${idx + 1}` : d
        }).join(', ')})` : ''
        return [
          `## ${i + 1}. ${t.title} — ${t.kind}${deps}`,
          t.scope ? `- **Scope:** ${t.scope}` : '',
          t.acceptance ? `- **Acceptance:** ${t.acceptance}` : '',
          t.provider ? `- **Agent:** ${providerLabelOf(t.provider)}` : '',
          t.status === 'skipped' ? `- **Skipped**${t.meta.skipNote ? `: ${t.meta.skipNote}` : ''}` : '',
          ...(t.meta.history ?? []).map((h) => `- **Changed:** ${h}`)
        ].filter(Boolean).join('\n')
      })
    ]
    writeFileSync(join(dir, 'PLAN.md'), lines.join('\n') + '\n', 'utf8')
    // Ensure STATUS.md exists so agents can append to it.
    const status = join(dir, 'STATUS.md')
    try { writeFileSync(status, `# Collab status log\n\nGoal: ${run.goal}\n`, { flag: 'wx' }) } catch { /* exists */ }
  } catch (e) { logError(`[collab] writePlanMd failed: ${String(e)}`) }
}
function appendStatus(run: CollabRun, line: string): void {
  try {
    const dir = runDirFor(run); mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'STATUS.md'), `\n${line}\n`, 'utf8')
  } catch { /* best-effort */ }
}

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
    emitChanged()
    return failed
  }
  if (!lockFor(run)) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: 'This conversation is busy with another turn. Wait for it to finish, then start Collab again.' })!
    emitChanged()
    return failed
  }
  if (!input.cwd || !input.cwd.trim()) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: 'Collab mode requires a project folder.' })!
    emitChanged()
    return failed
  }
  emitChanged()
  runPlanner(run.id)
  return run
}

// A lean summary of finished dependencies for a downstream agent — the compact
// handoff (files + verify) rather than the verbose STATUS.md, which stays a
// human-only audit log. This is what keeps a run's token cost from ballooning.
function completedContext(run: CollabRun): string {
  const passed = (run.tasks ?? []).filter((t) => t.status === 'passed' && t.handoff)
  if (!passed.length) return ''
  const lines = passed.map((t) => {
    const h = t.handoff!
    const files = h.filesChanged?.length ? h.filesChanged.join(', ') : '(none noted)'
    return `- **${t.title}** — files: ${files}${h.verify ? ` · to check: ${h.verify}` : ''}`
  })
  return ['## Work already completed by earlier tasks', ...lines,
    '', 'Open those files directly if your task builds on them. Do not read the full status log.'].join('\n')
}

// ── what each agent can do (D-108) ───────────────────────────────────────────
// Built-in agents read/write files and use tools; a user-added CLI's abilities are unknown
// to Troupe, so it is treated as text-only: inputs are pasted into its prompt and its
// deliverables are saved from its reply.
function capsOf(id: ProviderId) { try { return createProvider(id)?.getCapabilities() ?? null } catch { return null } }
const canWriteFiles = (id: ProviderId): boolean => !!capsOf(id)?.fileWrite
function abilitiesOf(id: ProviderId): string {
  const c = capsOf(id)
  if (!c || !c.fileWrite) return 'text replies only: cannot open project files, browse the web or run tools. Troupe pastes the task\'s input files into its prompt and saves its deliverables from the reply'
  return ['reads and writes files', c.shell ? 'runs shell commands' : '', c.web ? 'can browse the web' : ''].filter(Boolean).join(', ')
}
function agentsForPlanner(): string {
  const ids = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING))
  return ['Agents available for work tasks (do not assign any other provider):', ...ids.map((id) => `- "${id}" (${providerLabel(id, id)}): ${abilitiesOf(id)}.`),
    'Only give a text-only agent a task it can do from the text it is given: no web research, link checking or running anything; one or a few output files named in the scope; inputs named as "(read-only: path, …)" in the scope.'].join('\n')
}
const makerProviderOf = (run: CollabRun, task: CollabTask): ProviderId =>
  task.provider && enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(task.provider) ? task.provider : run.providerId

function probeIn(root: string) {
  return (rel: string) => {
    try {
      const abs = ensureInside(root, rel); const st = statSync(abs)
      if (st.isDirectory()) return { kind: 'dir' as const, size: 0, hasFiles: readdirSync(abs).some((n) => !n.startsWith('.')) }
      return { kind: 'file' as const, size: st.size }
    } catch { return { kind: 'none' as const, size: 0 } }
  }
}

// Input files for a text-only Maker: the scope's read-only inputs plus what its
// dependencies produced, pasted in (capped) since it cannot open them itself.
const INLINE_FILE_MAX = 40_000, INLINE_TOTAL_MAX = 120_000
function inlineInputs(run: CollabRun, task: CollabTask): string {
  const deps = (run.tasks ?? []).filter((t) => task.dependsOn.includes(t.id) && t.status === 'passed')
  const paths = [...scopePaths(task.scope).inputs, ...deps.flatMap((t) => scopePaths(t.scope).outputs)].filter((p, i, a) => a.indexOf(p) === i && !p.endsWith('/'))
  const parts: string[] = []; let total = 0
  for (const p of paths) {
    let text = ''
    try { text = readFileSync(ensureInside(run.projectCwd, p), 'utf8') } catch { parts.push(`### ${p}\n(could not be read)`); continue }
    if (text.includes('\u0000')) continue
    const room = Math.min(INLINE_FILE_MAX, INLINE_TOTAL_MAX - total); if (room <= 0) { parts.push(`### ${p}\n(left out: input limit reached)`); continue }
    const cut = text.length > room ? text.slice(0, room) + `\n… (truncated, ${text.length - room} more characters)` : text
    total += cut.length; parts.push(`### ${p}\n\`\`\`\`\n${cut}\n\`\`\`\``)
  }
  return parts.length ? ['## Input files (pasted by Troupe — you cannot open files yourself)', ...parts].join('\n\n') : ''
}

function runPlanner(runId: string): void {
  const run = getCollabRunBare(runId); if (!run) return
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const sender = wc(runId); if (!sender) { updateCollabRun(runId, { status: 'failed', reason: 'No app window to run in.' }); unlockFor(run); emitChanged(); return }
  const prompt = [
    `You are the Planner for a Collab run. Goal:`, '', run.goal, '',
    `Read the shared files under \`${relRunDir(run)}/\` if they exist.`,
    plannerContract(relRunDir(run), defaultOutputDir(run.goal, run.createdAt)),
    agentsForPlanner()
  ].join('\n')
  bumpRuns(runId)
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: run.providerId, prompt,
    cwd: run.projectCwd, timeoutMs: runTimeoutMs() * 3, permissionMode: run.permissionMode, model: strongModel(run.providerId) || undefined, skillIds: [SK_PROTOCOL, SK_PLANNER], noConversationContext: true,
    parallelGroup: `collab:${runId}:planner`,
    onDone: (mid, err) => onPlannerDone(runId, mid, err)
  })
  activeRunId.set(runId, rid)
}

function onPlannerDone(runId: string, messageId: string | null, err?: string): void {
  const run = getCollabRun(runId); if (!run || run.status === 'stopped') return
  if (err || !messageId) { updateCollabRun(runId, { status: 'failed', reason: err || 'Planner produced no output.' }); unlockFor(run); emitChanged(); return }
  const text = getMessage(messageId)?.content ?? ''
  const parsed = extractJson<{ tasks?: CollabTaskDraft[]; outputDir?: unknown }>(text)
  const tasks = parsed?.tasks
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    updateCollabRun(runId, { status: 'failed', reason: 'Could not read a task list from the plan. You can start Collab again.' }); unlockFor(run); emitChanged(); return
  }
  // D-064: deliverables go to a visible folder; any task path the Planner still put
  // under the hidden run folder is moved there.
  const outputDir = sanitizeOutputDir(parsed?.outputDir, defaultOutputDir(run.goal, run.createdAt))
  replaceTasks(runId, retargetTasks(tasks, relRunDir(run), outputDir))
  updateCollabRun(runId, { outputDir })
  const fresh = getCollabRun(runId)!
  writePlanMd(fresh, fresh.tasks!)
  updateCollabRun(runId, { status: 'awaiting_confirmation', reason: '' })
  unlockFor(fresh)
  emitChanged()
  logInfo(`[collab] plan ready: ${tasks.length} tasks`)
}

export function confirmPlan(sender: WebContents, runId: string, editedTasks?: CollabTaskDraft[]): CollabRun | null {
  const run = getCollabRun(runId); if (!run) return null
  senderFor.set(runId, sender)
  if (run.status !== 'awaiting_confirmation') return run
  if (editedTasks && editedTasks.length) replaceTasks(runId, run.outputDir ? retargetTasks(editedTasks, relRunDir(run), run.outputDir) : editedTasks)
  const fresh = getCollabRun(runId)!
  writePlanMd(fresh, fresh.tasks!)
  updateCollabRun(runId, { status: 'running', reason: '' })
  emitChanged()
  step(runId)
  return getCollabRun(runId)
}

export function stopCollab(runId: string): CollabRun | null {
  const run = getCollabRunBare(runId); if (!run) return null
  const rid = activeRunId.get(runId)
  if (rid) { void cancelRun(rid).catch(() => {}) }
  const stopped = updateCollabRun(runId, { status: 'stopped', reason: 'Stopped by you.' })
  unlockFor(run)
  emitChanged()
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
  emitChanged()
  step(runId)
  return getCollabRun(runId)
}

// small helper to persist a raised budget without widening the repo patch surface
function setBudget(runId: string, budget: CollabRun['budget']): void {
  getDb().prepare('UPDATE collab_runs SET budget_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(budget), Date.now(), runId)
}

// ── execution loop ─────────────────────────────────────────────────────────────
function step(runId: string): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  if (run.spent.runs >= run.budget.maxRuns) {
    updateCollabRun(runId, { status: 'needs_attention', reason: `Budget reached (${run.budget.maxRuns} agent runs). Resume to continue.` }); emitChanged(); return
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
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const task = getTask(taskId); if (!task) return
  const sender = wc(runId); if (!sender) { pause(runId, 'No app window to run in.'); return }
  updateTask(taskId, { status: 'in_progress', attempts: task.attempts + 1 })
  emitChanged()
  const retry = task.lastVerdict?.verdict === 'FAIL'
  // A task assigned to an agent that has since been turned off runs on the run's own agent (D-071).
  const makerProvider = makerProviderOf(run, task)
  const textOnly = !canWriteFiles(makerProvider)
  const outputs = scopePaths(task.scope).outputs
  const prompt = [
    `You are the Maker for this Collab task.`, '',
    `**Task:** ${task.title}`,
    task.scope ? `**Scope (only touch this):** ${task.scope}` : '',
    task.acceptance ? `**Acceptance criteria:** ${task.acceptance}` : '',
    run.outputDir && !textOnly ? `**Deliverables folder:** \`${run.outputDir}/\` — put what you produce there (create it if missing), never under \`.workbench/\`.` : '',
    textOnly ? inlineInputs(run, task) : completedContext(run),
    planChangesContext(run, task.id),
    task.meta.note ? `\n**Note from the user — follow it, it overrides earlier instructions:** ${task.meta.note}` : '',
    retry ? `\nThis is a retry. The reviewer's findings to address:\n${(task.lastVerdict?.findings ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
    textOnly ? textMakerContract(outputs.filter((p) => !p.endsWith('/'))) : makerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  // D-064: the run model only applies to the run's own provider (Codex was handed "opus").
  const makerModel = resolveTaskModel(run.providerId, run.model, makerProvider, makerProvider === task.provider ? task.model : null, modelLists(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING)))
  bumpRuns(runId, { retry })
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: makerProvider, model: makerModel || undefined, prompt,
    cwd: run.projectCwd, timeoutMs: runTimeoutMs() * 3, permissionMode: run.permissionMode, skillIds: [SK_PROTOCOL, SK_MAKER], noConversationContext: true,
    parallelGroup: `collab:${runId}:maker`,
    onDone: (mid, err) => onMakerDone(runId, taskId, mid, err)
  })
  activeRunId.set(runId, rid)
  updateTask(taskId, { makerRunId: rid })
}

function onMakerDone(runId: string, taskId: string, messageId: string | null, err?: string): void {
  const run = getCollabRunBare(runId); if (!run || run.status !== 'running') return
  if (err) { updateTask(taskId, { status: 'failed' }); pause(runId, `A Maker run errored on “${getTask(taskId)?.title ?? 'a task'}”: ${err}. Resume retries it.`); return }
  const reply = messageId ? getMessage(messageId)?.content ?? '' : ''
  if (messageId) {
    const h = extractJson<CollabHandoff>(reply)
    if (h) updateTask(taskId, { handoff: { status: h.status || 'done', filesChanged: Array.isArray(h.filesChanged) ? h.filesChanged : [], verify: h.verify || '' } })
  }
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
  runReviewer(runId, taskId, false)
}

// D-111: fingerprint of a task's output files, to tell "nothing changed since the last failure".
function outputsHash(run: CollabRun, task: CollabTask): string {
  const h = createHash('sha1')
  for (const p of scopePaths(task.scope).outputs) {
    h.update(p + '\0')
    try { const abs = ensureInside(run.projectCwd, p); const st = statSync(abs); h.update(st.isDirectory() ? readdirSync(abs).sort().join('|') : readFileSync(abs)) } catch { h.update('∅') }
  }
  return h.digest('hex').slice(0, 16)
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
  if (missing.length && !canWriteFiles(maker)) {
    const saved: string[] = []
    for (const f of filesFromReply(reply, missing)) {
      try {
        const abs = ensureInside(run.projectCwd, f.path)
        mkdirSync(join(abs, '..'), { recursive: true }); writeFileSync(abs, f.content, 'utf8'); saved.push(f.path)
      } catch (e) { logError(`[collab] could not save ${f.path} from reply: ${String(e)}`) }
    }
    if (saved.length) {
      const h = task.handoff
      updateTask(taskId, { handoff: { status: h?.status || 'done', filesChanged: [...new Set([...(h?.filesChanged ?? []), ...saved])], verify: h?.verify || '' } })
      appendStatus(run, `## ${today()} · App · ${task.title} — saved ${saved.map((p) => `\`${p}\``).join(', ')} from ${who}'s reply (text-only agent)\n\n---`)
      missing = missingOutputs(outputs, probe)
    }
  }
  if (!missing.length) return true
  const findings = missing.map((p) => `Deliverable missing: \`${p}\` ${p.endsWith('/') ? 'has no files' : 'was not written'} (checked by the app before review). Write it${canWriteFiles(maker) ? '' : ` — reply with it in a "=== FILE: ${p} ===" block`}.`)
  appendStatus(run, `## ${today()} · App check · task ${task.seq + 1} — ${task.title} · FAIL\n\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n---`)
  onTaskFailed(run.id, taskId, { verdict: 'FAIL', findings }, `${who} didn't produce ${missing.map((p) => `“${p}”`).join(', ')} after ${task.attempts} tries on “${task.title}”.`)
  return false
}

// ── failure handling, stall detection, recovery (D-109) ─────────────────────
// Every FAIL (app check or Reviewer) comes here. A work task with retries left goes
// back to its Maker — unless it failed the same way again, which means retrying
// unchanged won't help: then the Planner is asked for a repair. Otherwise the run
// pauses and the card offers: retry with a note, reassign, skip, or ask the Planner.
function onTaskFailed(runId: string, taskId: string, verdict: CollabVerdict, pausedWhy: string, opts?: { stuck?: string }): void {
  const task = getTask(taskId); if (!task) return
  const run0 = getCollabRunBare(runId); if (!run0) return
  // "Stuck" (D-111): the Maker says it's blocked, or the same failure came back (findings
  // compared by overlap, not exact words), or the output files didn't change since the
  // last failure. Retrying unchanged won't help any of these.
  const sig = failSig(verdict.findings)
  const sameFails = nextSameFails(task.meta.sig, task.meta.sameFails, sig)
  const outHash = task.kind === 'work' ? outputsHash(run0, task) : undefined
  const unchanged = !!outHash && !!task.meta.outHash && outHash === task.meta.outHash
  updateTask(taskId, { lastVerdict: verdict, meta: { ...task.meta, sig, sameFails, outHash } })
  const stuck = task.kind === 'work'
    ? (opts?.stuck ?? (sameFails >= STALL_AFTER ? `failed the same way ${sameFails} times in a row` : unchanged ? 'failed again with its files unchanged' : null))
    : null
  if (stuck) {
    updateTask(taskId, { status: 'failed' })
    appendStatus(run0, `## ${today()} · App · ${task.title} — stuck: ${stuck}. Asking the Planner for a fix instead of retrying unchanged.\n\n---`)
    startRepair(runId, taskId, { auto: true })
    return
  }
  const fresh = getCollabRunBare(runId)!
  if (task.kind === 'work' && task.attempts <= fresh.budget.maxRetriesPerTask) { runMaker(runId, taskId); return }
  updateTask(taskId, { status: 'failed' })
  pause(runId, `${pausedWhy} Fix it from the task below — retry with a note, give it to another agent, skip it, or ask the Planner — or Stop the run.`)
}

const TASK_NUM = (t: CollabTask) => `T${t.seq + 1}`
// What changed in the plan since it was confirmed (skips, reassignments, rewrites),
// so Makers and Reviewers work from the current plan, not the original one.
function planChangesContext(run: CollabRun, forTaskId: string | null): string {
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

function addHistory(meta: CollabTaskMeta, line: string): CollabTaskMeta {
  return { ...meta, history: [...(meta.history ?? []), `${today()} · ${line}`].slice(-6) }
}

function resumeAfterChange(runId: string): void {
  const run = getCollabRun(runId); if (!run) return
  writePlanMd(run, run.tasks ?? [])
  updateCollabRun(runId, { status: 'running', reason: '', repair: null })
  emitChanged()
  step(runId)
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
      meta: addHistory({ ...task.meta, note, sig: undefined, sameFails: 0, outHash: undefined }, `reassigned to ${who} by you`) })
    appendStatus(run, `## ${today()} · You · ${task.title} — given to ${who}${note ? `, with a note: ${note}` : ''}\n\n---`)
  } else {
    // retry — with a note it counts as new information, so the stall count restarts
    updateTask(taskId, { status: 'pending', attempts: 0, meta: note ? { ...task.meta, note, sig: undefined, sameFails: 0, outHash: undefined } : task.meta })
    appendStatus(run, `## ${today()} · You · ${task.title} — retry${note ? ` with a note: ${note}` : ''}\n\n---`)
  }
  resumeAfterChange(runId)
  return getCollabRun(runId)
}

// ── Planner repair ────────────────────────────────────────────────────────────
function repairContract(): string {
  return [
    '', '---',
    'Do not edit any files. End your reply with ONLY a fenced ```json block, no prose after it:',
    '```json',
    '{ "summary": "one sentence: why it keeps failing", "recommended": 0, "options": [',
    '  { "label": "short button text, e.g. Give T4 to Codex", "action": "reassign", "provider": "codex", "changesGoal": false, "note": "instruction for the Maker" },',
    '  { "label": "…", "action": "rewrite", "title": "…", "scope": "…", "acceptance": "…", "provider": "optional", "changesGoal": false, "note": "…" },',
    '  { "label": "…", "action": "retry", "changesGoal": false, "note": "what to do differently", "userStep": "optional: what the user must do first" },',
    '  { "label": "…", "action": "skip", "changesGoal": true, "note": "what later tasks should do without it" }',
    '] }',
    '```',
    'Options can only change THIS task: who does it (reassign), its title/scope/acceptance (rewrite), an instruction for its Maker (retry + note), or skipping it. They cannot create files, add tasks or change other tasks — Troupe has no way to do that. If the real fix needs the user to act outside Troupe first (add a missing file, sign in to an agent, install something), say so in "userStep" on a retry/reassign option (e.g. "userStep": "Add README.md to the project folder") — never write a label that promises Troupe will do it.',
    'Keep it short — the user reads this on a small card. "summary": ONE sentence, at most 25 words, plain language. Give 1–3 options; usually one clear best fix is enough, put it first or set "recommended". Labels at most 6 words ("Give T1 to Claude"). "userStep": one short sentence. Do not repeat the same fix with different agents — offer the single best agent. Prefer fixes that keep the goal intact: a different agent that can do the task (see abilities), clearer scope/acceptance, or a concrete instruction. Never offer to retry unchanged.',
    '"changesGoal": true ONLY when what gets delivered changes (different content, a dropped output, weaker acceptance). Giving the task to another agent is NOT a goal change, even if the user named the agent.'
  ].join('\n')
}

function startRepair(runId: string, taskId: string, opts: { auto: boolean; note?: string }): void {
  const run = getCollabRun(runId); if (!run) return
  const task = getTask(taskId); if (!task) return
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const sender = wc(runId); if (!sender) { unlockFor(run); pause(runId, 'No app window to run in.'); return }
  if (run.spent.runs >= run.budget.maxRuns) { unlockFor(run); pause(runId, `Budget reached (${run.budget.maxRuns} agent runs) while “${task.title}” needs a fix. Raise the budget, or fix the task yourself below.`); return }
  updateCollabRun(runId, { status: 'running', reason: `Asking the Planner how to fix “${task.title}”…`, repair: null })
  emitChanged()
  const tasks = run.tasks ?? []
  const maker = makerProviderOf(run, task)
  const dependents = tasks.filter((t) => t.dependsOn.includes(task.id)).map((t) => `${TASK_NUM(t)} “${t.title}”`)
  const prompt = [
    `You are the Planner for a Collab run, asked to REPAIR one task that keeps failing. Goal:`, '', run.goal, '',
    `The plan is in \`${relRunDir(run)}/PLAN.md\`; recent history is at the end of \`${relRunDir(run)}/STATUS.md\` (read only the last entries).`,
    '', '## Plan status',
    ...tasks.map((t) => `- ${TASK_NUM(t)} “${t.title}” — ${t.status}${t.provider ? ` · ${t.provider}` : ''}`),
    '', `## The failing task: ${TASK_NUM(task)} “${task.title}”`,
    `- Agent: "${maker}" (${abilitiesOf(maker)})`,
    task.scope ? `- Scope: ${task.scope}` : '',
    task.acceptance ? `- Acceptance: ${task.acceptance}` : '',
    `- Attempts: ${task.attempts}${task.meta.sameFails ? ` · same failure ${task.meta.sameFails} times in a row` : ''}`,
    dependents.length ? `- Later tasks that need it: ${dependents.join(', ')}` : '- No later task depends on it directly.',
    '', '## Latest findings', ...(task.lastVerdict?.findings ?? ['(none)']).map((f, i) => `${i + 1}. ${f}`),
    opts.note ? `\n## The user says\n${opts.note}` : '',
    '', agentsForPlanner(),
    repairContract()
  ].filter((l) => l !== '').join('\n')
  bumpRuns(runId, { retry: true })
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: run.providerId, prompt,
    cwd: run.projectCwd, timeoutMs: runTimeoutMs() * 2, permissionMode: 'read', model: strongModel(run.providerId) || undefined,
    skillIds: [SK_PROTOCOL, SK_PLANNER], noConversationContext: true,
    parallelGroup: `collab:${runId}:planner`,
    onDone: (mid, err) => onRepairDone(runId, taskId, mid, err, opts.auto)
  })
  activeRunId.set(runId, rid)
}

function onRepairDone(runId: string, taskId: string, messageId: string | null, err: string | undefined, auto: boolean): void {
  const run = getCollabRunBare(runId); if (!run || run.status !== 'running') return
  const task = getTask(taskId); if (!task) return
  const enabled = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING))
  const repair = err || !messageId ? null : parseRepair(extractJson<unknown>(getMessage(messageId)?.content ?? ''), taskId, (id) => enabled.includes(id as ProviderId))
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
  pause(runId, `“${task.title}” keeps failing the same way. Pick one of the Planner’s fixes, or fix it yourself from the task below.`)
}

function applyRepairOption(runId: string, taskId: string, o: CollabRepairOption, by: string): void {
  const task = getTask(taskId); if (!task) return
  const run = getCollabRunBare(runId); if (!run) return
  const meta: CollabTaskMeta = { ...task.meta, repairs: (task.meta.repairs ?? 0) + (by === 'the Planner' ? 1 : 0), sig: undefined, sameFails: 0, outHash: undefined, note: o.note ?? task.meta.note }
  if (o.action === 'skip') {
    updateTask(taskId, { status: 'skipped', meta: addHistory({ ...meta, skipNote: o.note }, `skipped (${by}): ${o.label}`) })
  } else if (o.action === 'reassign' && o.provider) {
    updateTask(taskId, { status: 'pending', attempts: 0, provider: o.provider, model: null, meta: addHistory(meta, `${o.label} (${by})`) })
  } else if (o.action === 'rewrite') {
    updateTask(taskId, {
      status: 'pending', attempts: 0, lastVerdict: null,
      ...(o.title ? { title: o.title } : {}), ...(o.scope ? { scope: o.scope } : {}), ...(o.acceptance ? { acceptance: o.acceptance } : {}),
      ...(o.provider ? { provider: o.provider, model: null } : {}),
      meta: addHistory(meta, `rewritten (${by}): ${o.label}`)
    })
  } else {
    updateTask(taskId, { status: 'pending', attempts: 0, meta: addHistory(meta, `retry with a new instruction (${by}): ${o.label}`) })
  }
  appendStatus(run, `## ${today()} · Plan change · ${task.title} — ${o.label} (${by})${o.userStep ? `\n\nDone by the user first: ${o.userStep}` : ''}\n\n---`)
  resumeAfterChange(runId)
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

function runReviewer(runId: string, taskId: string, _isFinal: boolean): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const task = getTask(taskId); if (!task) return
  const sender = wc(runId); if (!sender) { pause(runId, 'No app window to run in.'); return }
  if (task.kind === 'review') updateTask(taskId, { status: 'in_progress', attempts: task.attempts + 1 })
  emitChanged()
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
    planChangesContext(run, isWholeGoal ? null : task.id),
    'Open the files named above and verify against the acceptance criteria. Do not read the full status log.',
    reviewerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  bumpRuns(runId, { retry: task.kind === 'work' && task.attempts > 1 })
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: run.providerId, prompt,
    // Read-only on files, but allowed to search and fetch the web so it can verify
    // sources and URLs itself (D-064: several reviews failed for lack of it).
    cwd: run.projectCwd, timeoutMs: runTimeoutMs() * 3, permissionMode: 'read', allowWeb: true, model: strongModel(run.providerId) || undefined, skillIds: [SK_PROTOCOL, SK_REVIEWER], noConversationContext: true,
    parallelGroup: `collab:${runId}:reviewer`,
    onDone: (mid, err) => onReviewerDone(runId, taskId, mid, err)
  })
  activeRunId.set(runId, rid)
  updateTask(taskId, { reviewerRunId: rid })
}

function onReviewerDone(runId: string, taskId: string, messageId: string | null, err?: string): void {
  const run = getCollabRunBare(runId); if (!run || run.status !== 'running') return
  const task = getTask(taskId); if (!task) return
  if (err || !messageId) { updateTask(taskId, { status: 'failed' }); pause(runId, `A Reviewer run errored on “${task.title}”: ${err || 'no output'}. Resume retries it.`); return }
  const text = getMessage(messageId)?.content ?? ''
  let verdict = extractJson<CollabVerdict>(text)
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
      appendStatus(rn, `## ${today()} · Reviewer (${providerLabelOf(rn.providerId)}) · ${kindWord} — ${task.title} · ${verdict.verdict}\n\n${findings}\n\n---`)
    }
  }
  if (verdict.verdict === 'PASS') {
    updateTask(taskId, { status: 'passed', meta: { ...task.meta, note: undefined, sig: undefined, sameFails: 0 } })
    emitChanged()
    step(runId)
    return
  }
  // FAIL — retry, ask the Planner for a repair, or pause for the user (D-109).
  onTaskFailed(runId, taskId, verdict, task.kind === 'review' ? `The final review didn't pass.` : `“${task.title}” failed review after retries.`)
}

function pause(runId: string, reason: string): void {
  const r = updateCollabRun(runId, { status: 'needs_attention', reason })
  if (r) unlockFor(r)
  emitChanged()
}

function finalize(runId: string): void {
  const run = getCollabRun(runId); if (!run) return
  const tasks = run.tasks ?? []
  const passed = tasks.filter((t) => t.status === 'passed').length
  const failed = tasks.filter((t) => t.status === 'failed')
  const summary = failed.length
    ? `Completed ${passed}/${tasks.length} — ${failed.length} task(s) did not pass: ${failed.map((t) => t.title).join(', ')}`
    : `Completed ${passed}/${tasks.length} tasks toward: ${run.goal}`
  const mark = failed.length ? '⚠️ Collab run finished with unresolved tasks.' : '✅ Collab run complete.'
  appendStatus(run, `\n---\n${mark} ${summary}`)
  // D-064: a run with unresolved tasks is not "done" — it waits for Resume (retry) or Stop.
  if (failed.length) updateCollabRun(runId, { status: 'needs_attention', summary, reason: `${summary}. Resume retries ${failed.length === 1 ? 'it' : 'them'}; Stop ends the run.` })
  else updateCollabRun(runId, { status: 'done', summary, reason: '' })
  unlockFor(run)
  emitChanged()
  logInfo(`[collab] done: ${summary}`)
}
