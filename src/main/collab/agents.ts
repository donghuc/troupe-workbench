// Who does what in a Collab run (D-108, D-127): what each agent can do in this run, who makes
// and who reviews a task, and the attempt history. Split out of orchestrator.ts (audit #12).
import { join } from 'path'
import type { CollabRun, CollabTask, ProviderId, CollabTaskMeta, CollabTry } from '../../shared/types'
import { getTask, updateTask } from './collabRepo'
import { abilityIn, describeAbility, runLimits, type Ability, type RunSettings } from '../../shared/collabAbilities'
import { SHELL_SANDBOX_SETTING, sandboxOn } from '../../shared/shellSandbox'
import type { PermissionMode } from '../../shared/agent'
import { createProvider } from '../providers/registry'
import { modelForProvider, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { getSetting } from '../database/settingsRepo'
import { agentEntry, isProviderId, providerLabel, enabledProviderIds, DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { today } from './runtime'

export const providerLabelOf = (id: string): string => providerLabel(id, 'Claude')

// Planner + Reviewer always run on the provider's strong tier, regardless of a task's
// (possibly cheap) Maker model. Codex stays on its default until the catalog fix (backlog).
// Planner/Reviewer model; if it has been switched off (D-072) the agent's default is used.
export const strongModel = (id: string): string => (isProviderId(id) ? modelForProvider(id, agentEntry(id).strongModel || undefined, {}, parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))) : '')

// ── what each agent can do (D-108) ───────────────────────────────────────────
// Built-in agents read/write files and use tools; a user-added CLI's abilities are unknown
// to Troupe, so it is treated as text-only: inputs are pasted into its prompt and its
// deliverables are saved from its reply.
function capsOf(id: ProviderId) { try { return createProvider(id)?.getCapabilities() ?? null } catch { return null } }

export const canWriteFiles = (id: ProviderId): boolean => !!capsOf(id)?.fileWrite

// D-127: what an agent can do in THIS run — its own capabilities cut by the run's mode and the
// Tools settings. The Planner sees this, not the agent's general abilities.
function runSettings(run: CollabRun, mode: PermissionMode = run.permissionMode): RunSettings {
  return { mode, webOn: getSetting('agent_web_access') !== '0', shellOn: getSetting('agent_shell_access') !== '0', sandboxOn: sandboxOn(getSetting(SHELL_SANDBOX_SETTING)), windows: process.platform === 'win32' }
}

export const enabledAgents = (): ProviderId[] => enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).filter(isProviderId) as ProviderId[]

export const abilityOf = (run: CollabRun, id: ProviderId, mode?: PermissionMode): Ability => abilityIn(id, capsOf(id), runSettings(run, mode))
/** A Maker that can't change files itself in this run (text-only agent, or a Read-only run): Troupe saves its files from its reply. */

export const replyFiles = (run: CollabRun, id: ProviderId): boolean => !abilityOf(run, id).write

export function abilitiesOf(run: CollabRun, id: ProviderId): string { return describeAbility(abilityOf(run, id)) }

export function agentsForPlanner(run: CollabRun): string {
  const ids = enabledAgents()
  return ['Agents available for work tasks, and what each can do in THIS run (do not assign any other provider):', ...ids.map((id) => `- "${id}" (${providerLabel(id, id)}): ${abilitiesOf(run, id)}.`),
    runLimits(runSettings(run), ids.map((id) => abilityOf(run, id))),
    'Only give an agent that can\'t open files a task it can do from the text it is given: no web research, link checking or running anything; one or a few output files named in the scope; inputs named as "(read-only: path, …)" in the scope.'].join('\n')
}

export const makerProviderOf = (run: CollabRun, task: CollabTask): ProviderId =>
  task.provider && enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(task.provider) ? task.provider : run.providerId

// D-121: the Planner (or the user) can pick who reviews a task; it must be on and able to open files.
export const reviewerOf = (run: CollabRun, task: CollabTask): ProviderId => {
  const r = task.meta.reviewer
  return r && isProviderId(r) && enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(r) && canWriteFiles(r) ? r : run.providerId
}

// D-121: a handover must not leave the new Maker reviewing its own work (Hien's test: task 1
// went from Grok to Claude, and Claude — its reviewer — passed its own file). Pick another
// reviewer: the run's agent, else an agent that hasn't failed this task, else any other one.
export function handoverMeta(run: CollabRun, task: CollabTask, meta: CollabTaskMeta, newMaker: ProviderId): CollabTaskMeta {
  if (task.kind !== 'work' || reviewerOf(run, { ...task, meta }) !== newMaker) return meta
  const ok = enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).filter((id) => id !== newMaker && isProviderId(id) && canWriteFiles(id))
  const failed = new Set((meta.tries ?? []).filter((t) => t.result && t.result !== 'passed').map((t) => t.agent))
  const pick = ok.includes(run.providerId) ? run.providerId : ok.find((id) => !failed.has(id)) ?? ok[0]
  if (!pick) return meta   // only one agent available: nothing else can review
  return addHistory({ ...meta, reviewer: pick }, `review moved to ${providerLabelOf(pick)} so ${providerLabelOf(newMaker)} doesn't review its own work`)
}

// D-121: every attempt at a work task, kept across retries, reassignments and reworks.
export function startTry(task: CollabTask, agent: ProviderId): CollabTry[] { return [...(task.meta.tries ?? []), { agent }].slice(-20) }

export function endTry(taskId: string, result: CollabTry['result'], why?: string): void {
  const t = getTask(taskId); const tries = t?.meta.tries
  if (!t || !tries?.length || tries[tries.length - 1].result) return
  updateTask(taskId, { meta: { ...t.meta, tries: [...tries.slice(0, -1), { ...tries[tries.length - 1], result, ...(why ? { why } : {}) }] } })
}

export function addHistory(meta: CollabTaskMeta, line: string): CollabTaskMeta {
  return { ...meta, history: [...(meta.history ?? []), `${today()} · ${line}`].slice(-6) }
}
