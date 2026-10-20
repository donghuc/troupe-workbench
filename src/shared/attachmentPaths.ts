// Where attachments live (D-126). A file you attach is copied into the project so agents can
// open it; since 2.11.1 each chat has its own folder, and the composer says attachments are
// shared with the project's agents, with a list to see and delete them.

export const ATTACH_DIR = '.workbench/attachments'

/** File-system-safe name: keeps letters of any language (Vietnamese too), digits, dot, dash, underscore. */
export const safeAttachName = (name: string): string =>
  (name.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '_') || 'file').slice(0, 120)

/** `.workbench/attachments/<chat>/<time>-<name>` (chat id from our own ids: letters, digits, dash). */
export function attachmentRel(chatId: string | null | undefined, name: string, now = Date.now()): string {
  const chat = (chatId ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  return `${ATTACH_DIR}/${chat ? chat + '/' : ''}${now}-${safeAttachName(name)}`
}

/** The name you attached, without the time prefix. */
export const attachmentDisplayName = (file: string): string => file.replace(/^\d{10,}-/, '')

export interface ProjectAttachment {
  rel: string            // project-relative path
  name: string           // as attached
  bytes: number
  addedAt: number        // ms
  chatId: string | null  // null: attached before chats had their own folder
  chatTitle: string | null
}
