import { shell } from 'electron'
import { handle } from './handle'
import { getMessage, mergeMessageMetadata } from '../conversations/messagesRepo'
import { getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { isBusy } from '../agent/turns'
import { fileDiff, restorePaths, takeSnapshot } from '../agent/restorePoints'
import { changesOf } from '../../shared/changes'
import { logInfo } from '../util/logger'

// D-151: a reply's Changes card — the diff of one file, Restore, and Undo restore.
function context(messageId: string) {
  const m = getMessage(messageId); if (!m) throw new Error('That reply is gone')
  const c = changesOf(m.metadata); if (!c) throw new Error('This reply has no restore point')
  const conv = getConversation(m.conversationId)
  const root = conv ? getProject(conv.projectId)?.folderPath : null
  if (!root) throw new Error('This chat has no project folder')
  return { m, c, root }
}
const trash = async (abs: string) => { await shell.trashItem(abs) }

export function registerChangesIpc(): void {
  handle('changes.diff', async (_e, messageId: string, path: string) => {
    const { c, root } = context(messageId)
    if (!c.files.some((f) => f.path === path)) throw new Error('Not a file this reply changed')
    return fileDiff(root, c.before, c.after, path)
  })
  handle('changes.restore', async (_e, messageId: string) => {
    const { m, c, root } = context(messageId)
    if (isBusy(m.conversationId)) throw new Error('Wait for the agent to finish, then restore')
    if (c.restored) throw new Error('Already restored')
    const safety = await takeSnapshot(root, 'before-restore')
    if (!('id' in safety)) throw new Error('Couldn’t save the current files first, so nothing was restored')
    const failed = await restorePaths(root, c.before, c.files.map((f) => f.path), trash)
    logInfo('[restore] restored', { msg: messageId, files: c.files.length, failed: failed.length })
    mergeMessageMetadata(messageId, { changes: { ...c, restored: { at: Date.now(), safety: safety.id, ...(failed.length ? { failed } : {}) } } })
    return { failed }
  })
  handle('changes.undoRestore', async (_e, messageId: string) => {
    const { m, c, root } = context(messageId)
    if (isBusy(m.conversationId)) throw new Error('Wait for the agent to finish first')
    if (!c.restored) throw new Error('Nothing to undo')
    const failed = await restorePaths(root, c.restored.safety, c.files.map((f) => f.path), trash)
    const { restored: _r, ...rest } = c
    mergeMessageMetadata(messageId, { changes: rest })
    return { failed }
  })
}
