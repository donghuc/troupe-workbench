import { BrowserWindow, type WebContents } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, appendFileSync, statSync, readdirSync, readFileSync } from 'fs'
import { IPC } from '../../shared/ipc'
import { startRun, cancelRun, runTimeoutMs } from '../agent/runner'
import { acquireLock, releaseLock } from '../agent/turns'
import { getMessage } from '../conversations/messagesRepo'
import { logInfo, logError } from '../util/logger'
import { getDb } from '../database/db'
import type { CollabRun, CollabTask, CollabTaskDraft, CollabStartInput, CollabVerdict, CollabHandoff, ProviderId } from '../../shared/types'
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
          t.acceptance ? `- **Acceptance:** ${t.acceptance}` : ''
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
    pause(runId, `Waiting on ${failed.length ? failed.join(', ') : 'a task that did not pass'}. Resume retries ${failed.length === 1 ? 'it' : 'them'}.`)
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
    retry ? `\nThis is a retry. The reviewer's findings to address:\n${(task.lastVerdict?.findings ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
    textOnly ? textMakerContract(outputs.filter((p) => !p.endsWith('/'))) : makerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  // D-064: the run model only applies to the run's own provider (Codex was handed "opus").
  const makerModel = resolveTaskModel(run.providerId, run.model, makerProvider, makerProvider === task.provider ? task.model : null, modelLists(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING)))
  bumpRuns(runId)
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
  if (deliverablesGate(run, taskId, reply)) runReviewer(runId, taskId, false)
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
  updateTask(taskId, { lastVerdict: { verdict: 'FAIL', findings } })
  appendStatus(run, `## ${today()} · App check · task ${task.seq + 1} — ${task.title} · FAIL\n\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n---`)
  const fresh = getCollabRunBare(run.id)!
  if (task.attempts <= fresh.budget.maxRetriesPerTask) { runMaker(run.id, taskId); return false }
  updateTask(taskId, { status: 'failed' })
  const other = providerLabelOf(run.providerId)
  pause(run.id, `${who} didn't produce ${missing.map((p) => `“${p}”`).join(', ')} after ${task.attempts} tries on “${task.title}”. ${maker !== run.providerId ? `To give it to ${other}, turn ${who} off in Settings › Agents, then Resume.` : 'Resume retries it; Stop ends the run.'}`)
  return false
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
    'Open the files named above and verify against the acceptance criteria. Do not read the full status log.',
    reviewerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  bumpRuns(runId)
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
    updateTask(taskId, { status: 'passed' })
    emitChanged()
    step(runId)
    return
  }
  // FAIL — retry the Maker if this is a work task with retries left.
  const fresh = getCollabRunBare(runId)!
  const canRetry = task.kind === 'work' && task.attempts <= fresh.budget.maxRetriesPerTask
  if (canRetry) { runMaker(runId, taskId); return }
  updateTask(taskId, { status: 'failed' })
  pause(runId, `Task failed review after retries: “${task.title}”. Review the findings; Resume retries it with them, Stop ends the run.`)
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
