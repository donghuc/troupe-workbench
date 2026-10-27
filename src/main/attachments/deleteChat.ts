// Deleting a chat also deletes the attachments it copied into the project (D-130). They are
// Troupe's copies (the originals stay where you had them); left behind they piled up under
// "A deleted chat" and the project's agents could still read them.
import { deleteConversation, getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { countChatAttachments, removeChatAttachments } from './projectAttachments'
import { logInfo } from '../util/logger'
import { getDb } from '../database/db'
import { attachmentsDir } from './attachmentStore'
import { promises as fs } from 'fs'
import { sep } from 'path'

// Audit 2026-10-26: files attached in a chat with no project folder are kept in the app's own
// store (userData/attachments), named by time, not by chat — so they were never deleted. Find
// them from the chat's messages; delete those no other chat still refers to.
function storeFilesOf(chatId: string, dir = attachmentsDir()): string[] {
  const rows = getDb().prepare("SELECT metadata FROM messages WHERE conversation_id = ? AND metadata LIKE '%attachments%'").all(chatId) as { metadata: string }[]
  const out = new Set<string>()
  for (const r of rows) {
    try {
      const list = (JSON.parse(r.metadata) as { attachments?: { path?: unknown }[] }).attachments ?? []
      for (const a of list) if (typeof a.path === 'string' && a.path.startsWith(dir + sep) && !a.path.slice(dir.length + 1).includes(sep)) out.add(a.path)
    } catch { /* not ours */ }
  }
  return [...out]
}
const stillUsed = (path: string): boolean =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM messages WHERE instr(metadata, ?) > 0").get(JSON.stringify(path).slice(1, -1)) as { n: number }).n > 0

const rootOf = (chatId: string): string | null => {
  const c = getConversation(chatId)
  return c ? getProject(c.projectId)?.folderPath ?? null : null
}

export async function chatAttachmentCount(chatId: string): Promise<number> {
  const root = rootOf(chatId)
  return (root ? await countChatAttachments(root, chatId) : 0) + storeFilesOf(chatId).length
}

export async function deleteChatWithFiles(chatId: string): Promise<void> {
  const root = rootOf(chatId)
  const stored = storeFilesOf(chatId)
  deleteConversation(chatId)
  for (const p of stored) { if (!stillUsed(p)) await fs.rm(p, { force: true }).catch(() => {}) }
  if (stored.length) logInfo('attachments: deleted a chat\'s stored files', { chat: chatId, n: stored.length })
  if (!root) return
  await removeChatAttachments(root, chatId).catch((e: unknown) => logInfo('attachments: could not delete a deleted chat\'s files', { chat: chatId, error: String(e).slice(0, 200) }))
}
