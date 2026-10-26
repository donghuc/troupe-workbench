import { BrowserWindow, type WebContents } from 'electron'
import { hideWorkbenchDir } from '../platform/winFs'
import { join } from 'path'
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, appendFileSync, statSync, readdirSync, readFileSync, existsSync } from 'fs'
import { IPC } from '../../shared/ipc'
import { startRun, cancelRun, runTimeoutMs } from '../agent/runner'
import { acquireLock, releaseLock } from '../agent/turns'
import type { TurnOutcome } from '../../shared/turnQueue'
import { getMessage } from '../conversations/messagesRepo'
import { logInfo, logError } from '../util/logger'
import { getDb } from '../database/db'
import type { CollabRun, CollabTask, CollabTaskDraft, CollabStartInput, CollabVerdict, CollabHandoff, ProviderId, CollabRecoverAction, CollabRepairOption, CollabTaskMeta, CollabTry } from '../../shared/types'
import { failSig, nextSameFails, parseRepair, STALL_AFTER, PERMISSION_BLOCKED_RE } from '../../shared/collabRecovery'
import { planBudget, planIssues, parseWrapUp, triesText } from '../../shared/collabChecks'
import {
  createCollabRun, getCollabRun, getCollabRunBare, updateCollabRun, bumpRuns,
  replaceTasks, getTask, updateTask, listCollabRuns
} from './collabRepo'
import { extractJson, findingToText } from './parse'
import { scopePaths, missingOutputs, filesFromReply, textMakerInstructions, FILE_BLOCK_START } from '../../shared/collabFiles'
import { abilityIn, describeAbility, runLimits, needOfTool, needOfText, runBlocker, NEED_WORD, type Ability, type RunSettings, type Need } from '../../shared/collabAbilities'
import { SHELL_SANDBOX_SETTING, sandboxOn } from '../../shared/shellSandbox'
import { snapshot, diffSnapshots, type Snapshot } from './projectSnapshot'
import type { PermissionMode } from '../../shared/agent'
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
// P0-3 (audit 2026-10-26): say how the run's hold ended, so the chat's queue pauses after a Stop
// or failure and waits while the run waits for you (plan to approve, needs attention).
function unlockFor(run: { id: string; conversationId: string }, outcome: TurnOutcome = 'done'): void { releaseLock(run.conversationId, holder(run.id), outcome) }

// P0-1: an error while handling an agent's finish used to vanish (the runner swallows it) and
// leave the run "running" with the chat locked. Now it is logged and the run pauses, which
// unlocks the chat; Resume picks it up again.
function guarded<A extends unknown[]>(runId: string, what: string, fn: (...a: A) => void): (...a: A) => void {
  return (...a: A) => {
    try { fn(...a) } catch (e) {
      logError(`[collab] ${what} failed`, { run: runId, err: String((e as Error)?.stack ?? e) })
      try { pause(runId, `Troupe hit an error after the ${what} finished (${String((e as Error)?.message ?? e).slice(0, 160)}). Resume to carry on.`) } catch (e2) {
        // Even the pause failed (database trouble): at least give the chat back.
        logError('[collab] pause after error failed', { run: runId, err: String(e2) })
        const r = getCollabRunBare(runId); if (r) unlockFor(r, 'error')
        emitChanged()
      }
    }
  }
}

function emitChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(IPC.collabChanged) }
}

// D-121: every Collab agent reply is tagged, so the chat shows it as one line (expandable)
// instead of the full text, and the Done card can sit after the run's last message.
type CollabRole = 'planner' | 'maker' | 'reviewer' | 'repair' | 'wrapup'
const tag = (runId: string, role: CollabRole, task?: CollabTask): Record<string, unknown> =>
  ({ collab: { runId, role, ...(task ? { task: task.seq + 1, title: task.title } : {}) } })

// D-121: per-role deadlines (were all 3× the run timeout — 45 min by default — so a hung
// agent stalled a run for most of an hour). Makers get the most; checks and summaries less.
const ROLE_TIMEOUT: Record<CollabRole, number> = { planner: 1.5, maker: 2, reviewer: 1, repair: 1, wrapup: 1 }
const timeoutFor = (role: CollabRole): number => Math.round(runTimeoutMs() * ROLE_TIMEOUT[role])

// ── machine I/O contracts (app-owned; NOT in the editable skills) ─────────────
function plannerContract(runDir: string, suggestedOut: string): string {
  return [
    '',
    '---',
    `Where things go: \`${runDir}/\` is the app's bookkeeping folder — only PLAN.md and STATUS.md live there. It is hidden in the app, so NEVER put deliverables under \`.workbench/\`. Choose one visible project folder for everything the tasks produce and set it as "outputDir" (suggested: \`${suggestedOut}\`; reuse an existing project folder if the goal names one). Every task's scope names paths inside outputDir (or existing project files it edits).`,
    `Do not write PLAN.md or STATUS.md yourself — the app writes both from your JSON (a read-only run can't write them anyway). End your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    `{ "outputDir": "${suggestedOut}", "conflicts": [], "tasks": [ { "title": "...", "kind": "work", "provider": "claude-code", "model": "haiku", "reviewer": "codex", "scope": "files or area this task owns", "acceptance": "how anyone can tell it is done and correct", "dependsOn": [] } ] }`,
    '"conflicts": list, in one plain sentence each, anything in the goal that contradicts itself or can\'t all be met (e.g. "the goal asks for 5 questions but also says to write only 4"), and decisions only the user can make before work starts. Leave it empty when there are none. Do NOT quietly pick a side in a task: the user sees these before approving and can edit the goal.',
    '```',
    'Rules: kind is "work" (a Maker builds it, a Reviewer checks it) or "review" (Reviewer-only). dependsOn holds zero-based indices of earlier tasks. Include a final { "kind": "review" } task that checks the whole result against the goal. Keep tasks few and non-overlapping. If a task reads or builds on another task\'s output, it MUST list that task in dependsOn — it will not start until that task has passed review.',
    'For each WORK task, optionally set provider (one of the agents listed below) and model to fit its difficulty and cost: mechanical or read-heavy work → a cheap, fast Claude model ("haiku"); code-heavy work → "codex"; hard synthesis → a strong Claude model ("opus"); "grok" is an alternative generalist. "model" applies to Claude only — omit it for "codex" and "grok". Omit both to use the run default. On a review task, provider and model are ignored.',
    '"reviewer" (optional, any task, including the final review): which agent reviews it — e.g. a different agent from the Maker for an independent check, or the one strongest at the subject. Only agents that read and write files can review. Omit it to use the run default; it always runs on that agent\'s strong model.'
  ].join('\n')
}
function makerContract(runDir: string): string {
  return [
    '',
    '---',
    `Do not write \`${runDir}/STATUS.md\` — the app records your handoff there from the JSON below. End your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
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
    'verdict is "PASS" only if every acceptance criterion is met with no blocking issue; otherwise "FAIL" with a numbered, specific findings list (each tied to a file or a reproduction step). You do not edit the work.',
    'If you could not check the work at all — you could not open the files, or a tool you need was refused — use "verdict": "BLOCKED" and say in findings what stopped you. That is not the Maker\'s fault: never FAIL for it.',
    'Who made the work and which files changed are settled by Troupe\'s record above. Not having git history, not knowing who wrote a file, or not being able to prove nothing else changed is NOT a reason to BLOCK or FAIL — judge the files against the acceptance criteria.'
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
    mkdirSync(dir, { recursive: true }); hideWorkbenchDir(run.projectCwd)
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
    const dir = runDirFor(run); mkdirSync(dir, { recursive: true }); hideWorkbenchDir(run.projectCwd)
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
  // P0-1: check the folder before taking the chat's lock (a failure here used to keep it locked).
  if (!input.cwd || !input.cwd.trim()) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: 'Collab mode requires a project folder.' })!
    emitChanged()
    return failed
  }
  if (!lockFor(run)) {
    const failed = updateCollabRun(run.id, { status: 'failed', reason: 'This conversation is busy with another turn. Wait for it to finish, then start Collab again.' })!
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
    const rec = recordText(t)
    return `- **${t.title}** — files: ${files}${h.verify ? ` · to check: ${h.verify}` : ''}${rec ? `\n  ${rec.slice(2)}` : ''}`
  })
  return ['## Work already completed by earlier tasks (with what Troupe recorded — facts)', ...lines,
    '', 'Open those files directly if your task builds on them. Do not read the full status log.'].join('\n')
}

// ── what each agent can do (D-108) ───────────────────────────────────────────
// Built-in agents read/write files and use tools; a user-added CLI's abilities are unknown
// to Troupe, so it is treated as text-only: inputs are pasted into its prompt and its
// deliverables are saved from its reply.
function capsOf(id: ProviderId) { try { return createProvider(id)?.getCapabilities() ?? null } catch { return null } }
const canWriteFiles = (id: ProviderId): boolean => !!capsOf(id)?.fileWrite
// D-127: what an agent can do in THIS run — its own capabilities cut by the run's mode and the
// Tools settings. The Planner sees this, not the agent's general abilities.
function runSettings(run: CollabRun, mode: PermissionMode = run.permissionMode): RunSettings {
  return { mode, webOn: getSetting('agent_web_access') !== '0', shellOn: getSetting('agent_shell_access') !== '0', sandboxOn: sandboxOn(getSetting(SHELL_SANDBOX_SETTING)), windows: process.platform === 'win32' }
}
const enabledAgents = (): ProviderId[] => enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).filter(isProviderId) as ProviderId[]
const abilityOf = (run: CollabRun, id: ProviderId, mode?: PermissionMode): Ability => abilityIn(id, capsOf(id), runSettings(run, mode))
/** A Maker that can't change files itself in this run (text-only agent, or a Read-only run): Troupe saves its files from its reply. */
const replyFiles = (run: CollabRun, id: ProviderId): boolean => !abilityOf(run, id).write
function abilitiesOf(run: CollabRun, id: ProviderId): string { return describeAbility(abilityOf(run, id)) }
function agentsForPlanner(run: CollabRun): string {
  const ids = enabledAgents()
  return ['Agents available for work tasks, and what each can do in THIS run (do not assign any other provider):', ...ids.map((id) => `- "${id}" (${providerLabel(id, id)}): ${abilitiesOf(run, id)}.`),
    runLimits(runSettings(run), ids.map((id) => abilityOf(run, id))),
    'Only give an agent that can\'t open files a task it can do from the text it is given: no web research, link checking or running anything; one or a few output files named in the scope; inputs named as "(read-only: path, …)" in the scope.'].join('\n')
}
const makerProviderOf = (run: CollabRun, task: CollabTask): ProviderId =>
  task.provider && enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(task.provider) ? task.provider : run.providerId
// D-121: the Planner (or the user) can pick who reviews a task; it must be on and able to open files.
const reviewerOf = (run: CollabRun, task: CollabTask): ProviderId => {
  const r = task.meta.reviewer
  return r && isProviderId(r) && enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(r) && canWriteFiles(r) ? r : run.providerId
}
// D-121: a handover must not leave the new Maker reviewing its own work (Hien's test: task 1
// went from Grok to Claude, and Claude — its reviewer — passed its own file). Pick another
// reviewer: the run's agent, else an agent that hasn't failed this task, else any other one.
function handoverMeta(run: CollabRun, task: CollabTask, meta: CollabTaskMeta, newMaker: ProviderId): CollabTaskMeta {
  if (task.kind !== 'work' || reviewerOf(run, { ...task, meta }) !== newMaker) return meta
  const ok = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).filter((id) => id !== newMaker && isProviderId(id) && canWriteFiles(id))
  const failed = new Set((meta.tries ?? []).filter((t) => t.result && t.result !== 'passed').map((t) => t.agent))
  const pick = ok.includes(run.providerId) ? run.providerId : ok.find((id) => !failed.has(id)) ?? ok[0]
  if (!pick) return meta   // only one agent available: nothing else can review
  return addHistory({ ...meta, reviewer: pick }, `review moved to ${providerLabelOf(pick)} so ${providerLabelOf(newMaker)} doesn't review its own work`)
}
// D-121: every attempt at a work task, kept across retries, reassignments and reworks.
function startTry(task: CollabTask, agent: ProviderId): CollabTry[] { return [...(task.meta.tries ?? []), { agent }].slice(-20) }
function endTry(taskId: string, result: CollabTry['result'], why?: string): void {
  const t = getTask(taskId); const tries = t?.meta.tries
  if (!t || !tries?.length || tries[tries.length - 1].result) return
  updateTask(taskId, { meta: { ...t.meta, tries: [...tries.slice(0, -1), { ...tries[tries.length - 1], result, ...(why ? { why } : {}) }] } })
}

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
  const sender = wc(runId); if (!sender) { updateCollabRun(runId, { status: 'failed', reason: 'No app window to run in.' }); unlockFor(run, 'error'); emitChanged(); return }
  const prompt = [
    `You are the Planner for a Collab run. Goal:`, '', run.goal, '',
    `Read the shared files under \`${relRunDir(run)}/\` if they exist.`,
    plannerContract(relRunDir(run), defaultOutputDir(run.goal, run.createdAt)),
    agentsForPlanner(run)
  ].join('\n')
  bumpRuns(runId)
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: run.providerId, prompt,
    cwd: run.projectCwd, timeoutMs: timeoutFor('planner'), permissionMode: run.permissionMode, model: strongModel(run.providerId) || undefined, skillIds: [SK_PROTOCOL, SK_PLANNER], noConversationContext: true,
    parallelGroup: `collab:${runId}:planner`, extraMetadata: tag(runId, 'planner'),
    onDone: guarded(runId, 'Planner', (mid, err) => onPlannerDone(runId, mid, err))
  })
  activeRunId.set(runId, rid)
}

function onPlannerDone(runId: string, messageId: string | null, err?: string): void {
  const run = getCollabRun(runId); if (!run || run.status === 'stopped') return
  if (err || !messageId) { updateCollabRun(runId, { status: 'failed', reason: err || 'Planner produced no output.' }); unlockFor(run, 'error'); emitChanged(); return }
  const text = getMessage(messageId)?.content ?? ''
  const parsed = extractJson<{ tasks?: CollabTaskDraft[]; outputDir?: unknown; conflicts?: unknown }>(text)
  const tasks = parsed?.tasks
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    updateCollabRun(runId, { status: 'failed', reason: 'Could not read a task list from the plan. You can start Collab again.' }); unlockFor(run, 'error'); emitChanged(); return
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
  emitChanged()
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
  emitChanged()
  step(runId)
  return getCollabRun(runId)
}

export function stopCollab(runId: string): CollabRun | null {
  const run = getCollabRun(runId); if (!run) return null
  const rid = activeRunId.get(runId)
  if (rid) { activeRunId.delete(runId); void cancelRun(rid).catch(() => {}) }
  const wasPlanning = run.status === 'planning' || run.status === 'awaiting_confirmation'
  // D-121: a stopped run still gets a wrap-up — what got done, what didn't — once any task ran.
  const worked = !wasPlanning && (run.tasks ?? []).some((t) => t.attempts > 0)
  const stopped = updateCollabRun(runId, { status: 'stopped', reason: worked ? 'Stopped by you. Writing a short wrap-up…' : 'Stopped by you.', ...(wasPlanning ? {} : { summary: countsSummary(run, true) }) })
  // P0-3: with a wrap-up to write, the run keeps the chat until it's written (onWrapUpDone
  // releases it as 'stopped'), so a queued message can't run first and push the wrap-up out.
  if (!worked) unlockFor(run, 'stopped')
  emitChanged()
  logInfo('[collab] stopped', { run: runId, was: run.status, wrapUp: worked })
  // After the cancelled agent has let go of the conversation (its own onDone ignores a stopped run).
  if (worked) setTimeout(() => {
    if (!runWrapUp(runId, 'stopped')) { updateCollabRun(runId, { reason: 'Stopped by you.' }); unlockFor(run, 'stopped'); emitChanged() }
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

// D-128: the project as it was when each task's current Maker attempt started (in memory only;
// after a restart the record says the change list is unknown).
const makerSnaps = new Map<string, Snapshot | null>()
function recordAttempt(run: CollabRun, task: CollabTask): void {
  const before = makerSnaps.get(task.id)
  const after = before ? snapshot(run.projectCwd) : null
  const d = before && after ? diffSnapshots(before, after) : { added: [], changed: [], removed: [] }
  const maker = makerProviderOf(run, task)
  updateTask(task.id, { meta: { ...(getTask(task.id)?.meta ?? task.meta), recorded: { by: maker, savedByTroupe: replyFiles(run, maker), ...d, complete: !!(before && after) } } })
}
const fileList = (fs: string[], max = 15): string => fs.length ? fs.slice(0, max).map((f) => `\`${f}\``).join(', ') + (fs.length > max ? ` and ${fs.length - max} more` : '') : 'none'
/** The record as facts for a Reviewer or the wrap-up. */
function recordText(t: CollabTask): string {
  const r = t.meta.recorded
  if (!r) return ''
  const who = `${providerLabelOf(r.by)}${r.savedByTroupe ? ' (its files were saved by Troupe from its reply)' : ''}`
  if (!r.complete) return `- Made by ${who}. Troupe couldn't list every file that changed (the project is too large to compare).`
  const parts = [r.added.length ? `added ${fileList(r.added)}` : '', r.changed.length ? `changed ${fileList(r.changed)}` : '', r.removed.length ? `removed ${fileList(r.removed)}` : ''].filter(Boolean)
  return `- Made by ${who}. While it worked, the project ${parts.length ? parts.join('; ') : 'had no file changes'} — nothing else changed (build, dependency and .workbench folders aren't compared).`
}

function runMaker(runId: string, taskId: string): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const task = getTask(taskId); if (!task) { pause(runId, 'A task in this run could not be found. Resume to carry on.'); return }   // P0-1: unlocks
  const sender = wc(runId); if (!sender) { pause(runId, 'No app window to run in.'); return }
  // A task assigned to an agent that has since been turned off runs on the run's own agent (D-071).
  const makerProvider = makerProviderOf(run, task)
  // D-121: fingerprint the outputs before this attempt, to catch "says done, wrote nothing".
  ensureOutputDirs(run, task)
  makerSnaps.set(taskId, snapshot(run.projectCwd))   // D-128: what the project looked like before
  updateTask(taskId, { status: 'in_progress', attempts: task.attempts + 1, meta: { ...task.meta, startHash: outputsHash(run, task), tries: startTry(task, makerProvider) } })
  emitChanged()
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
  bumpRuns(runId, { retry })
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: makerProvider, model: makerModel || undefined, prompt,
    cwd: run.projectCwd, timeoutMs: timeoutFor('maker'), permissionMode: run.permissionMode, skillIds: [SK_PROTOCOL, SK_MAKER], noConversationContext: true,
    parallelGroup: `collab:${runId}:maker`, extraMetadata: tag(runId, 'maker', task),
    onDone: guarded(runId, 'Maker', (mid, err) => onMakerDone(runId, taskId, mid, err))
  })
  activeRunId.set(runId, rid)
  updateTask(taskId, { makerRunId: rid })
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

// D-121: create the deliverables folder and each output's parent folder before a Maker starts,
// so no agent needs a shell command (mkdir) just to have somewhere to write. Grok in Auto can't
// run shell commands at all, and stopped after announcing its plan when it tried.
function ensureOutputDirs(run: CollabRun, task: CollabTask): void {
  const dirs = new Set<string>(run.outputDir ? [run.outputDir] : [])
  for (const p of scopePaths(task.scope).outputs) dirs.add(p.endsWith('/') ? p : p.split('/').slice(0, -1).join('/'))
  for (const d of dirs) { if (!d) continue; try { mkdirSync(ensureInside(run.projectCwd, d), { recursive: true }) } catch { /* outside the project or not creatable: the gate reports it */ } }
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
function runLimited(run: CollabRun, task: CollabTask, need: Need | null, what: string): boolean {
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

function onTaskFailed(runId: string, taskId: string, verdict: CollabVerdict, pausedWhy: string, opts?: { stuck?: string }): void {
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
  if (task.kind === 'work' && task.attempts <= fresh.budget.maxRetriesPerTask) { runMaker(runId, taskId); return }
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

// ── Planner repair ────────────────────────────────────────────────────────────
function repairContract(isReview = false): string {
  return [
    ...(isReview ? [
      '', '---',
      'This is the FINAL review of the whole result. Fixes here say which WORK task to redo: use "action": "rework" with "task": its plan number (as in Plan status) and a "note" telling its Maker exactly what to change, from the findings. Offer one rework per task that needs it (up to 3), recommended first. "retry" re-runs this review with a note (only if the review itself was wrong). "skip" accepts the result as it is (changesGoal: true).',
      'Example: { "label": "Redo T2 with the findings", "action": "rework", "task": 2, "changesGoal": false, "note": "Add the missing 5th question and its answer" }'
    ] : []),
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
    'Every option must be something that can be applied now, from the card. If the cause is in Troupe or an agent\'s setup (an agent can\'t read files, a tool is refused), say so in "summary" and offer reassign or rewrite — never "retry after fixing X" when X needs a change to Troupe\'s code or settings.',
    'Use the agents\' abilities IN THIS RUN (listed below) — not what they can do elsewhere. If a finding says the agent "was blocked asking permission" for a tool, that agent can\'t use it here: give the task to an agent that CAN in this run, or rewrite the task so it doesn\'t need it. If no agent here can, don\'t move it between agents — say so in "summary" and offer a rewrite or skip (Troupe offers the user the run-mode switch itself).',
    '"changesGoal": true ONLY when what gets delivered changes (different content, a dropped output, weaker acceptance). Giving the task to another agent is NOT a goal change, even if the user named the agent.',
    'If the failures come from the GOAL itself (it contradicts itself or the acceptance criteria — e.g. it says to write 4 questions while acceptance needs 5), renaming the task or switching agents will not help, because the next Maker reads the same goal. Then make the recommended option say so, with "changesGoal": true and "goal": the full corrected goal text — the user confirms it before anything changes.'
  ].join('\n')
}

function startRepair(runId: string, taskId: string, opts: { auto: boolean; note?: string }): void {
  const run = getCollabRun(runId); if (!run) return
  const task = getTask(taskId); if (!task) return
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const sender = wc(runId); if (!sender) { pause(runId, 'No app window to run in.'); return }
  if (run.spent.runs >= run.budget.maxRuns) { pause(runId, `Budget reached (${run.budget.maxRuns} agent runs) while “${task.title}” needs a fix. Raise the budget, or fix the task yourself below.`); return }
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
  bumpRuns(runId, { retry: true })
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: run.providerId, prompt,
    cwd: run.projectCwd, timeoutMs: timeoutFor('repair'), permissionMode: 'read', model: strongModel(run.providerId) || undefined,
    skillIds: [SK_PROTOCOL, SK_PLANNER], noConversationContext: true,
    parallelGroup: `collab:${runId}:planner`, extraMetadata: tag(runId, 'repair', task),
    onDone: guarded(runId, 'repair run', (mid, err) => onRepairDone(runId, taskId, mid, err, opts.auto))
  })
  activeRunId.set(runId, rid)
}

// D-121: the files behind the findings, so a fix is based on what was actually written — not
// on what the Maker said it wrote. "changed": compared with the start of the last attempt.
function outputState(run: CollabRun, task: CollabTask): string[] {
  const outs = task.kind === 'review'
    ? (run.tasks ?? []).filter((t) => t.kind === 'work').flatMap((t) => scopePaths(t.scope).outputs)
    : scopePaths(task.scope).outputs
  if (!outs.length) return []
  const changed = task.kind === 'work' && task.meta.startHash ? (outputsHash(run, task) !== task.meta.startHash ? 'yes' : 'NO — unchanged') : null
  const lines = outs.slice(0, 12).map((p) => {
    try { const st = statSync(ensureInside(run.projectCwd, p)); return `- \`${p}\` — ${st.isDirectory() ? 'folder' : `${st.size} bytes`}` } catch { return `- \`${p}\` — missing` }
  })
  return ['', '## Output files now (open them before proposing a fix)', ...lines, ...(changed ? [`Changed by the last attempt: ${changed}`] : [])]
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

function setRunPermission(runId: string, mode: PermissionMode): void {
  getDb().prepare('UPDATE collab_runs SET permission_mode = ?, updated_at = ? WHERE id = ?').run(mode, Date.now(), runId)
}

/** D-127: switch a run between Read-only and Auto before approving it, or while it's paused. Never to Full access. */
export function setCollabMode(runId: string, mode: 'read' | 'auto'): CollabRun | null {
  const run = getCollabRunBare(runId); if (!run) return null
  if (mode !== 'read' && mode !== 'auto') throw new Error('A Collab run can be switched only between Read-only and Auto.')
  if (!['awaiting_confirmation', 'needs_attention'].includes(run.status)) throw new Error('Switch the mode before running, or while the run is paused.')
  if (run.permissionMode === mode) return getCollabRun(runId)
  setRunPermission(runId, mode)
  appendStatus(run, `## ${today()} · You · run switched to ${mode === 'auto' ? 'Auto' : 'Read-only'}\n\n---`)
  emitChanged()
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

function runReviewer(runId: string, taskId: string, _isFinal: boolean): void {
  const run = getCollabRun(runId); if (!run || run.status !== 'running') return
  if (!lockFor(run)) { pause(runId, 'This conversation is busy with another turn. Resume when it finishes.'); return }
  const task = getTask(taskId); if (!task) { pause(runId, 'A task in this run could not be found. Resume to carry on.'); return }   // P0-1: unlocks
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
    // D-128: Troupe's record — facts, so the review is about the work, not about proving its history.
    !isWholeGoal && task.meta.recorded ? ['', '## What Troupe recorded for this attempt (facts — no need to verify them)', recordText(task)].join('\n') : '',
    planChangesContext(run, isWholeGoal ? null : task.id),
    'Open the files named above and verify against the acceptance criteria. Do not read the full status log.',
    readHint(reviewerOf(run, task)),
    reviewerContract(relRunDir(run))
  ].filter(Boolean).join('\n')
  bumpRuns(runId, { retry: task.kind === 'work' && task.attempts > 1 })
  const reviewer = reviewerOf(run, task)
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: reviewer, prompt,
    // Read-only on files, but allowed to search and fetch the web so it can verify
    // sources and URLs itself (D-064: several reviews failed for lack of it).
    cwd: run.projectCwd, timeoutMs: timeoutFor('reviewer'), permissionMode: 'read', allowWeb: true, model: strongModel(reviewer) || undefined, skillIds: [SK_PROTOCOL, SK_REVIEWER], noConversationContext: true,
    parallelGroup: `collab:${runId}:reviewer`, extraMetadata: tag(runId, 'reviewer', task),
    onDone: guarded(runId, 'Reviewer', (mid, err) => onReviewerDone(runId, taskId, mid, err))
  })
  activeRunId.set(runId, rid)
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
    emitChanged()
    step(runId)
    return
  }
  // FAIL — retry, ask the Planner for a repair, or pause for the user (D-109).
  { const tf = getTask(taskId); if (tf) updateTask(taskId, { meta: { ...tf.meta, lastFailKind: 'review' } }) }
  onTaskFailed(runId, taskId, verdict, task.kind === 'review' ? `The final review didn't pass.` : `“${task.title}” failed review after retries.`)
}

/** How this reviewer reads files in a read-only run (D-121: Codex refused to use its shell). */
function readHint(reviewer: ProviderId): string {
  return reviewer === 'codex'
    ? 'You read files through your shell. This run\'s sandbox is read-only, so read-only commands — cat, ls, rg, head, sed -n — are allowed and expected. Don\'t run anything that writes.'
    : 'Read the files with your file-reading tools.'
}

/** Every finding says the Reviewer couldn't open or check the work, and none names a defect. */
export function reviewerCouldNotCheck(findings: string[]): boolean {
  const access = /(could ?n[o']t|can ?n[o']t|cannot|unable to|was not able to|no (?:direct )?(?:local[- ]file |file[- ])?(?:read(?:ing)? )?(?:tool|access)|not (?:allowed|permitted) to (?:run|read|open)|prohibit)/i
  const fileish = /(read|open|access|view|inspect|verify|check).{0,60}(file|\.md|\.json|\.csv|folder|director|path|\b[\w-]+\.\w{1,5}\b)|tool|command/i
  return findings.length > 0 && findings.every((f) => access.test(f) && fileish.test(f))
}

/** The Reviewer couldn't check the work: move the review to another agent and run it again. */
// D-128: say what actually stopped the reviewer (the wrap-up retold every block as "couldn't open the files").
const shortReason = (r: string): string => { const one = r.replace(/\s+/g, ' ').trim(); return one.length > 140 ? one.slice(0, 137) + '…' : one }
function reviewBlocked(runId: string, taskId: string, why: string[]): void {
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
  emitChanged()
  runReviewer(runId, taskId, false)
}

function pause(runId: string, reason: string): void {
  const r = updateCollabRun(runId, { status: 'needs_attention', reason })
  if (r) unlockFor(r, 'waiting')   // the run isn't over: queued messages wait for Resume / Stop
  emitChanged()
}

/** The app's own one-line result (D-121) — plain text for the Done card; the wrap-up tells the story. */
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
  const failed = (run.tasks ?? []).filter((t) => t.status === 'failed')
  // D-121: skipped tasks are part of the result (a run that skipped its final review used to
  // read "done" with no mention of it).
  const summary = countsSummary(run)
  const mark = failed.length ? '⚠️ Collab run finished with unresolved tasks.' : '✅ Collab run complete.'
  appendStatus(run, `\n---\n${mark} ${summary}`)
  // D-064: a run with unresolved tasks is not "done" — it waits for Resume (retry) or Stop.
  if (failed.length) {
    updateCollabRun(runId, { status: 'needs_attention', summary, reason: `${summary}. Resume retries ${failed.length === 1 ? 'it' : 'them'}; Stop ends the run.` })
    unlockFor(run, 'waiting'); emitChanged()
    return
  }
  // D-121: every finished run ends with the Planner's wrap-up — outcome, files, decisions for
  // the user, follow-ups — shown in the chat and on the Done card.
  updateCollabRun(runId, { summary, reason: 'Writing the wrap-up…' })
  emitChanged()
  if (!runWrapUp(runId, 'done')) {
    updateCollabRun(runId, { status: 'done', reason: '' })
    unlockFor(run); emitChanged()
  }
  logInfo(`[collab] done: ${summary}`)
}

// ── wrap-up (D-121) ──────────────────────────────────────────────────────────
const wrapUps = new Map<string, string>()   // runId → wrap-up agent run id in flight

function wrapUpPrompt(run: CollabRun, ending: 'done' | 'stopped'): string {
  const tasks = run.tasks ?? []
  const line = (t: CollabTask) => {
    const who = t.kind === 'review' ? 'review' : providerLabelOf(makerProviderOf(run, t))
    const files = t.handoff?.filesChanged?.length ? ` · files: ${t.handoff.filesChanged.join(', ')}` : ''
    const why = t.status === 'failed' && t.lastVerdict?.findings?.[0] ? ` · last finding: ${t.lastVerdict.findings[0]}` : t.status === 'skipped' && t.meta.skipNote ? ` · ${t.meta.skipNote}` : ''
    // D-121: the real record — every attempt and who made it, and every plan change. The
    // wrap-up once said Grok "was never tested" after Grok had failed twice and Claude took over.
    const tries = t.kind === 'work' && t.meta.tries?.length ? `\n  attempts, in order: ${triesText(t.meta.tries, (a) => providerLabelOf(a))}` : ''
    const changes = t.meta.history?.length ? `\n  plan changes: ${t.meta.history.join('; ')}` : ''
    const rec = t.kind === 'work' ? recordText(t) : ''
    return `- ${TASK_NUM(t)} “${t.title}” — ${t.status.replace('_', ' ')} · ${who}${t.kind === 'work' ? ` · reviewed by ${providerLabelOf(reviewerOf(run, t))}` : ''}${files}${why}${tries}${changes}${rec ? `\n  record: ${rec.slice(2)}` : ''}`
  }
  return [
    `You are the Planner. Write the WRAP-UP for a Collab run that ${ending === 'stopped' ? 'the user STOPPED before it finished' : 'has finished'}. Goal:`, '', run.goal, '',
    '## Tasks', ...tasks.map(line),
    run.outputDir ? `\nDeliverables folder: \`${run.outputDir}/\`` : '',
    '', 'The attempts, plan changes and records above are what happened — report them as they are (who tried, what failed, who took over, and the exact reason a review moved); do not guess or paraphrase a reason into another one.',
    'Open the deliverables to judge them (read only — do not edit any file, do not read STATUS.md in full).',
    'Reply in markdown with exactly these four sections, under 200 words in total, no JSON:',
    '## Outcome', `One or two sentences on what the run actually delivered, judged against the goal — not a restatement of the goal.${ending === 'stopped' ? ' Say what got done, what did not, and where it stopped.' : ''}`,
    '## Files', '- `path` — what it is (one line each)',
    '## Decisions for you', '- choices only the user can make, or "None"',
    '## Follow-ups', '- concrete next steps, or "None"'
  ].filter((l) => l !== '').join('\n')
}

/** Start the wrap-up; false when it can't run (no window, conversation busy). */
function runWrapUp(runId: string, ending: 'done' | 'stopped'): boolean {
  const run = getCollabRun(runId); if (!run) return false
  if (!lockFor(run)) return false
  const sender = wc(runId); if (!sender) return false   // the caller releases the lock with the run's outcome
  bumpRuns(runId)
  const rid = startRun(sender, {
    conversationId: run.conversationId, providerId: run.providerId, prompt: wrapUpPrompt(run, ending),
    cwd: run.projectCwd, timeoutMs: timeoutFor('wrapup'), permissionMode: 'read', model: strongModel(run.providerId) || undefined,
    skillIds: [SK_PROTOCOL, SK_PLANNER], noConversationContext: true,
    parallelGroup: `collab:${runId}:planner`, extraMetadata: tag(runId, 'wrapup'),
    onDone: (mid, err) => {
      try { onWrapUpDone(runId, ending, mid, err) } catch (e) {
        logError('[collab] wrap-up handling failed', { run: runId, err: String((e as Error)?.stack ?? e) })
        const r = getCollabRunBare(runId); if (r) unlockFor(r, ending === 'stopped' ? 'stopped' : 'done')
        emitChanged()
      }
    }
  })
  wrapUps.set(runId, rid)
  if (ending === 'done') activeRunId.set(runId, rid)
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
  emitChanged()
}

