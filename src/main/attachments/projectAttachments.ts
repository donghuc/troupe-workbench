import { promises as fs } from 'fs'
import { join } from 'path'
import { ensureInside } from '../filesystem/fsService'
import { getConversation } from '../conversations/conversationsRepo'
import { ATTACH_DIR, attachmentDisplayName, type ProjectAttachment } from '../../shared/attachmentPaths'

// D-126: the attachments copied into a project, to see and delete them (Composer ▸ Manage).

export async function listProjectAttachments(root: string): Promise<ProjectAttachment[]> {
  const base = ensureInside(root, ATTACH_DIR)
  const out: ProjectAttachment[] = []
  const add = async (dir: string, relDir: string, chatId: string | null) => {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory() && chatId === null && relDir === ATTACH_DIR) { await add(join(dir, e.name), `${relDir}/${e.name}`, e.name); continue }
      if (!e.isFile()) continue
      try {
        const st = await fs.stat(join(dir, e.name))
        out.push({ rel: `${relDir}/${e.name}`, name: attachmentDisplayName(e.name), bytes: st.size, addedAt: st.mtimeMs, chatId, chatTitle: chatId ? getConversation(chatId)?.title ?? null : null })
      } catch { /* gone */ }
    }
  }
  await add(base, ATTACH_DIR, null)
  return out.sort((a, b) => b.addedAt - a.addedAt)
}

/** Delete one attachment (only inside the attachments folder); removes an emptied chat folder. */
export async function removeProjectAttachment(root: string, rel: string): Promise<void> {
  if (!rel.startsWith(ATTACH_DIR + '/') || rel.split('/').includes('..')) throw new Error('Not an attachment.')
  const abs = ensureInside(root, rel)
  await fs.rm(abs, { force: true })
  const parts = rel.split('/')
  if (parts.length === 4) await fs.rmdir(ensureInside(root, parts.slice(0, 3).join('/'))).catch(() => { /* not empty */ })
}

const chatDir = (chatId: string): string => {
  const id = chatId.replace(/[^A-Za-z0-9_-]/g, '')
  if (!id) throw new Error('Not a chat.')
  return `${ATTACH_DIR}/${id}`
}

/** How many files this chat attached (its own folder only — older shared files aren't counted). */
export async function countChatAttachments(root: string, chatId: string): Promise<number> {
  try { return (await fs.readdir(ensureInside(root, chatDir(chatId)), { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith('.')).length } catch { return 0 }
}

/** Delete a chat's attachment folder — called when the chat is deleted. Older shared files stay. */
export async function removeChatAttachments(root: string, chatId: string): Promise<void> {
  await fs.rm(ensureInside(root, chatDir(chatId)), { recursive: true, force: true })
}
