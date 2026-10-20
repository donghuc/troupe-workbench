import { handle } from './handle'
import { startCollab, confirmPlan, stopCollab, resumeCollab, recoverTask, applyRepair, setCollabMode } from '../collab/orchestrator'
import { expectString } from '../security/pathGuard'
import { getCollabRun, listCollabRuns } from '../collab/collabRepo'
import type { CollabStartInput, CollabTaskDraft, CollabRecoverAction } from '../../shared/types'

export function registerCollabIpc(): void {
  handle('collab.start', (e, input: CollabStartInput) => startCollab(e.sender, input))
  handle('collab.confirmPlan', (e, runId: string, editedTasks?: CollabTaskDraft[]) => confirmPlan(e.sender, runId, editedTasks))
  handle('collab.stop', (_e, runId: string) => stopCollab(runId))
  handle('collab.setMode', (_e, runId: string, mode: 'read' | 'auto') => setCollabMode(expectString(runId, 'runId'), mode === 'auto' ? 'auto' : 'read'))
  handle('collab.resume', (e, runId: string, opts?: { raiseBudget?: boolean }) => resumeCollab(e.sender, runId, opts))
  handle('collab.recover', (e, runId: string, taskId: string, action: CollabRecoverAction) => recoverTask(e.sender, runId, taskId, action))
  handle('collab.applyRepair', (e, runId: string, index: number) => applyRepair(e.sender, runId, index))
  handle('collab.get', (_e, runId: string) => getCollabRun(runId))
  handle('collab.list', (_e, conversationId: string) => listCollabRuns(conversationId))
}
