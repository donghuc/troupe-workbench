// One place that assembles what an agent is told besides your message (audit #16, 2026-10-27):
// instructions, global then project memory (only when its own memory file doesn't already carry
// it — D-055), reference context, the working-folder rules, then skills, the chat summary and
// attachments. Five agents each had a copy of this list; the D-055 rule now lives once.
import type { AgentRequest } from '../../shared/agent'
import type { ProviderId } from '../../shared/types'
import { workFolderRules } from '../../shared/contextBudget'
import { memoryDelivery, globalMemoryDelivery } from '../context/projectMemory'

export interface ContextOptions {
  /** First, before everything else (e.g. a read-only note). */
  lead?: string
  /** Replaces the working-folder rules ('' leaves them out — Grok sends them as --rules). */
  rules?: string
  /** Last (e.g. Claude's web-routing line). */
  tail?: string
  /** Skills, the chat summary and attachments. Claude gets those elsewhere (false). */
  withTurnContext?: boolean
}

export function buildContextBlock(id: ProviderId, req: AgentRequest, o: ContextOptions = {}): string {
  const ctx = req.context
  const memory = memoryDelivery(id, req.cwd ?? null, ctx?.memory ?? '') === 'injected' ? ctx?.memory : undefined
  const globalMemory = globalMemoryDelivery(id, ctx?.globalMemory ?? '') === 'injected' ? ctx?.globalMemory : undefined
  const rules = o.rules === undefined ? workFolderRules(req.cwd, req.addDirs) : o.rules
  const turn = o.withTurnContext === false ? [] : [ctx?.skillText, ctx?.snapshot, ctx?.attachmentsText]
  return [o.lead, ctx?.instructions, globalMemory, memory, ctx?.persistentContext, rules, ...turn, o.tail].filter(Boolean).join('\n\n')
}

/** For agents with no system-prompt flag: the block goes in a delimited preamble (D-003). */
export const withPreamble = (block: string, prompt: string): string =>
  block.trim() ? `<workbench_context>\n${block}\n</workbench_context>\n\n${prompt}` : prompt
