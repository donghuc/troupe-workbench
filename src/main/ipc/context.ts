import { handle } from './handle'
import { listContextFiles, addContextFile, removeContextFile } from '../context/contextRepo'
import { inspectContext } from '../context/contextBuilder'
import { getSetting, setSetting } from '../database/settingsRepo'
import type { ProviderId } from '../../shared/types'
import { draftOutcome } from '../context/outcomes'
import { checkProjectContext } from '../context/contextCheck'
import { saveOutcome, listOutcomes } from '../context/decisionsRepo'
import { getProject } from '../projects/projectsRepo'
import { expectString } from '../security/pathGuard'
import type { Outcome } from '../../shared/decisions'

export function registerContextIpc(): void {
  handle('context.list', (_e, projectId: string) => listContextFiles(projectId))
  handle('context.add', (_e, projectId: string, relPath: string) => addContextFile(projectId, relPath))
  handle('context.remove', (_e, projectId: string, relPath: string) => removeContextFile(projectId, relPath))
  handle('context.inspect', (_e, conversationId: string, providerId?: ProviderId) => inspectContext(conversationId, providerId))
  // Decisions log (D-081): draft with the drafting agent, save on approval, list for the inspector/UI.
  handle('outcomes.draft', (_e, conversationId: string, messageId?: string) => draftOutcome(expectString(conversationId, 'conversationId'), typeof messageId === 'string' ? messageId : undefined))
  handle('outcomes.save', (_e, projectId: string, o: Outcome) => {
    const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    const kind = o?.kind === 'insight' || o?.kind === 'question' ? o.kind : 'decision'
    const title = clean(o?.title, 200); if (!title) throw new Error('The outcome needs a title.')
    return saveOutcome(expectString(projectId, 'projectId'), { kind, title, date: /^\d{4}-\d{2}-\d{2}$/.test(o?.date ?? '') ? o.date : new Date().toISOString().slice(0, 10), why: clean(o?.why, 2000) || undefined, considered: clean(o?.considered, 2000) || undefined, open: clean(o?.open, 2000) || undefined, source: clean(o?.source, 200) || undefined })
  })
  handle('outcomes.check', (_e, projectId: string) => checkProjectContext(expectString(projectId, 'projectId')))
  handle('outcomes.list', (_e, projectId: string) => { const p = getProject(expectString(projectId, 'projectId')); return p ? listOutcomes(p) : [] })
  handle('settings.get', (_e, key: string) => getSetting(key))
  handle('settings.set', (_e, key: string, value: string) => setSetting(key, value))
}
