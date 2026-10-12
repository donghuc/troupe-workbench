import { handle } from './handle'
import { startCollab, confirmPlan, stopCollab, resumeCollab } from '../collab/orchestrator'
import { getCollabRun, listCollabRuns } from '../collab/collabRepo'
import type { CollabStartInput, CollabTaskDraft } from '../../shared/types'

export function registerCollabIpc(): void {
  handle('collab.start', (e, input: CollabStartInput) => startCollab(e.sender, input))
  handle('collab.confirmPlan', (e, runId: string, editedTasks?: CollabTaskDraft[]) => confirmPlan(e.sender, runId, editedTasks))
  handle('collab.stop', (_e, runId: string) => stopCollab(runId))
  handle('collab.resume', (e, runId: string, opts?: { raiseBudget?: boolean }) => resumeCollab(e.sender, runId, opts))
  handle('collab.get', (_e, runId: string) => getCollabRun(runId))
  handle('collab.list', (_e, conversationId: string) => listCollabRuns(conversationId))
}
