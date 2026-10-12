import { app } from 'electron'
import { createProvider } from '../providers/registry'
import { getProject } from '../projects/projectsRepo'
import { getSetting } from '../database/settingsRepo'
import { listOutcomes } from './decisionsRepo'
import { projectStartingPack } from './contextBuilder'
import { resolveThinkingAgent, THINKING_AGENT_SETTING, THINKING_MODEL_SETTING } from '../../shared/thinking'
import { DISABLED_AGENTS_SETTING } from '../../shared/providers'
import { modelForProvider, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { modelLists } from '../tools/codexModels'
import { checkQuestions, answerPrompt, gradePrompt, parseGrades, type CheckResult } from '../../shared/contextCheck'
import { logInfo } from '../util/logger'
import type { ProviderId } from '../../shared/types'

export interface ContextCheckReport { agent: ProviderId; results: CheckResult[]; passed: number; total: number }

async function runOnce(agent: ProviderId, prompt: string, context: Parameters<NonNullable<ReturnType<typeof createProvider>>['run']>[0]['context'], cwd: string): Promise<string> {
  const provider = createProvider(agent)
  if (!provider) throw new Error('No agent available')
  const model = modelForProvider(agent, getSetting(THINKING_MODEL_SETTING) || undefined, modelLists(), parseDisabledModels(getSetting(DISABLED_MODELS_SETTING))) || undefined
  let text = ''
  for await (const ev of provider.run({ prompt, context, cwd, model, permissionMode: 'read' }, undefined)) {
    if (ev.type === 'text_delta') text += ev.text
    else if (ev.type === 'error' && ev.fatal) throw new Error(ev.message)
  }
  return text
}

// Check context (D-082): a fresh run with the project's real starting pack answers
// questions drawn from the decisions log; the drafting agent grades. Two runs, on demand.
export async function checkProjectContext(projectId: string): Promise<ContextCheckReport> {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found')
  const qs = checkQuestions(listOutcomes(project))
  if (!qs.length) throw new Error('Nothing to check yet — save an outcome first.')
  const agent = resolveThinkingAgent(getSetting(THINKING_AGENT_SETTING), getSetting(DISABLED_AGENTS_SETTING))
  const cwd = project.folderPath ?? app.getPath('temp')
  logInfo('context check start', { project: projectId, agent, questions: qs.length })
  const answers = await runOnce(agent, answerPrompt(qs), projectStartingPack(project), cwd)
  const grades = await runOnce(agent, gradePrompt(qs, answers), {}, app.getPath('temp'))
  const results = parseGrades(grades, qs, answers)
  const passed = results.filter((r) => r.ok).length
  logInfo('context check done', { project: projectId, passed, total: results.length })
  return { agent, results, passed, total: results.length }
}
