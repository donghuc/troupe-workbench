import { dialog } from 'electron'
import { handle } from './handle'
import { writeFile } from 'fs/promises'
import type { ProviderId, NewMessageInput } from '../../shared/types'
import {
  listConversations, listRecentConversations, getConversation, createConversation, renameConversation, setConversationPinned, setConversationPermissionMode, branchConversation, searchAll
} from '../conversations/conversationsRepo'
import { listMessages, appendMessage, deleteMessagesFrom } from '../conversations/messagesRepo'
import { setSetting } from '../database/settingsRepo'
import { deleteChatWithFiles, chatAttachmentCount } from '../attachments/deleteChat'
import { providerLabel } from '../../shared/providers'

export function registerConversationIpc(): void {
  handle('conversations.list', (_e, projectId: string) => listConversations(projectId))
  handle('conversations.recent', (_e, limit?: number) => listRecentConversations(limit))
  handle('conversations.get', (_e, id: string) => getConversation(id))
  handle('conversations.create', (_e, projectId: string, title: string, provider: ProviderId) =>
    createConversation(projectId, title, provider))
  handle('conversations.rename', (_e, id: string, title: string) => renameConversation(id, title))
  handle('conversations.remove', (_e, id: string) => deleteChatWithFiles(id))
  handle('conversations.attachmentCount', (_e, id: string) => chatAttachmentCount(id))
  handle('conversations.setPinned', (_e, id: string, pinned: boolean) => setConversationPinned(id, pinned))
  // Remember the composer's permission mode for this chat AND as the app-wide last
  // choice, so a new chat starts where the user left off.
  handle('conversations.setPermissionMode', (_e, id: string, mode: string) => { setConversationPermissionMode(id, mode); setSetting('last_permission_mode', mode) })
  handle('messages.list', (_e, conversationId: string) => listMessages(conversationId))
  handle('messages.deleteFrom', (_e, conversationId: string, messageId: string) => deleteMessagesFrom(conversationId, messageId))
  handle('conversations.branch', (_e, convId: string, throughMessageId: string | null) => branchConversation(convId, throughMessageId))
  handle('conversations.search', (_e, query: string) => (query.trim() ? searchAll(query.trim()) : []))
  handle('conversations.export', async (_e, convId: string) => {
    const conv = getConversation(convId)
    if (!conv) return null
    const msgs = listMessages(convId)
    const who = (m: { role: string; provider: string | null }) => (m.role === 'user' ? 'You' : providerLabel(m.provider, 'Claude'))
    const md = [`# ${conv.title}`, '', ...msgs.flatMap((m) => [`## ${who(m)}`, '', m.content, ''])].join('\n')
    const res = await dialog.showSaveDialog({ defaultPath: `${(conv.title || 'conversation').replace(/[^\w.-]+/g, '-')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, md, 'utf8')
    return res.filePath
  })
  handle('messages.append', (_e, input: NewMessageInput) => appendMessage(input))
}
