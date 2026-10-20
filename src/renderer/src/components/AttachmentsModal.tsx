import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { Stack } from './Form'
import Icon from './Icon'
import { Button, IconButton } from './ui/Button'
import { confirmDialog } from './ui/ConfirmDialog'
import { api } from '../api'
import { failed } from '../notices'
import { shortDate } from '../dates'
import { OS_WORDS } from '../../../shared/platform'
import type { ProjectAttachment } from '../../../shared/attachmentPaths'

const size = (b: number): string => (b < 1024 ? `${b} B` : b < 1_048_576 ? `${Math.round(b / 1024)} KB` : `${(b / 1_048_576).toFixed(1)} MB`)

// D-126: the files attached in this project's chats. They are copies inside the project
// (.workbench/attachments), so the project's agents can open them — this is where you see
// and delete them. The chat you're in comes first.
export default function AttachmentsModal({ root, chatId, onClose }: { root: string; chatId?: string; onClose: () => void }) {
  const [items, setItems] = useState<ProjectAttachment[] | null>(null)
  const load = () => api.attachments.list(root).then((l: ProjectAttachment[]) => setItems(l)).catch((e: unknown) => { setItems([]); failed('List attachments')(e) })
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; files: ProjectAttachment[] }>()
    for (const a of items ?? []) {
      const key = a.chatId ?? ''
      const title = a.chatId ? (a.chatTitle ?? 'A deleted chat') : 'Older attachments (shared by all chats)'
      if (!m.has(key)) m.set(key, { key, title, files: [] })
      m.get(key)!.files.push(a)
    }
    return [...m.values()].sort((a, b) => (a.key === chatId ? -1 : b.key === chatId ? 1 : 0))
  }, [items, chatId])

  const remove = async (files: ProjectAttachment[], what: string) => {
    if (!(await confirmDialog({ title: `Delete ${what}?`, message: 'The copies in this project are deleted. Messages that used them keep their text but can no longer open the files.', confirmLabel: 'Delete' }))) return
    for (const f of files) await api.attachments.remove(root, f.rel).catch(failed('Delete attachment'))
    await load()
  }

  return (
    <Modal title="Attachments in this project" wide onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <Stack>
      <p className="field-hint">Files you attach are copied into the project so agents can open them. Each chat keeps its own, and agents are told to open only their chat's — but any agent working in this project can read them.</p>
      {items === null && <div className="field-hint">Loading…</div>}
      {items?.length === 0 && <div className="field-hint">No attachments yet.</div>}
      {groups.map((g) => (
        <section key={g.key} className="attach-group">
          <div className="attach-group-head">
            <span className="attach-group-title truncate">{g.key === chatId ? `${g.title} · this chat` : g.title}</span>
            <Button size="sm" danger onClick={() => void remove(g.files, g.files.length === 1 ? 'this attachment' : `these ${g.files.length} attachments`)}><Icon name="trash" size="sm" /> Delete all</Button>
          </div>
          {g.files.map((f) => (
            <div key={f.rel} className="attach-row">
              <Icon name="file" size="md" />
              <span className="attach-row-name truncate" title={f.rel}>{f.name}</span>
              <span className="attach-row-meta">{size(f.bytes)} · {shortDate(f.addedAt)}</span>
              <IconButton title={OS_WORDS.showInFolder} onClick={() => api.system.revealItem(root, f.rel).catch(failed(OS_WORDS.showInFolder))}><Icon name="folder-open" size="sm" /></IconButton>
              <IconButton title="Delete" onClick={() => void remove([f], `“${f.name}”`)}><Icon name="trash" size="sm" /></IconButton>
            </div>
          ))}
        </section>
      ))}
      </Stack>
    </Modal>
  )
}
