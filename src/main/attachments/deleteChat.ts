// Deleting a chat also deletes the attachments it copied into the project (D-130). They are
// Troupe's copies (the originals stay where you had them); left behind they piled up under
// "A deleted chat" and the project's agents could still read them.
import { deleteConversation, getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { countChatAttachments, removeChatAttachments } from './projectAttachments'
import { logInfo } from '../util/logger'

const rootOf = (chatId: string): string | null => {
  const c = getConversation(chatId)
  return c ? getProject(c.projectId)?.folderPath ?? null : null
}

export async function chatAttachmentCount(chatId: string): Promise<number> {
  const root = rootOf(chatId)
  return root ? countChatAttachments(root, chatId) : 0
}

export async function deleteChatWithFiles(chatId: string): Promise<void> {
  const root = rootOf(chatId)
  deleteConversation(chatId)
  if (!root) return
  await removeChatAttachments(root, chatId).catch((e: unknown) => logInfo('attachments: could not delete a deleted chat\'s files', { chat: chatId, error: String(e).slice(0, 200) }))
}
