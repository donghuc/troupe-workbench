import { useState } from 'react'
import Icon from './Icon'
import { Menu, MenuItem } from './ui/Menu'
import { api } from '../api'
import { useQueue, applyQueue } from '../queueStore'
import { failed } from '../notices'
import type { QueuePause, QueuedMessage, QueueState } from '../../../shared/turnQueue'

// D-138: messages sent while the chat is busy, tucked behind the top of the composer. Each runs
// as its own turn when the one before it finishes. Remove one, or edit it from ⋯. Stop or a
// failed reply pauses the queue until you Resume.
const PAUSE_WORD: Record<QueuePause, string> = { stopped: 'Paused after Stop', error: 'Paused — the last reply failed', restart: 'Paused — Troupe restarted' }

export default function QueueList({ conversationId }: { conversationId: string }) {
  const q = useQueue(conversationId)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  if (!q.items.length) return null

  const act = (p: Promise<QueueState>, what: string) => { p.then(applyQueue, failed(what)) }
  const startEdit = (m: QueuedMessage) => { setMenu(null); setEditing(m.id); setDraft(m.text) }
  const saveEdit = (m: QueuedMessage) => { setEditing(null); if (draft.trim() !== m.text) act(api.queue.edit(conversationId, m.id, draft), 'Edit queued message') }

  return (
    <div className="queue-list" role="region" aria-label="Queued messages">
      {q.paused && (
        <div className="queue-paused" title={q.error ?? undefined}>
          <span>{PAUSE_WORD[q.paused]}</span>
          <button className="queue-link" onClick={() => act(api.queue.resume(conversationId), 'Resume queue')}>Resume</button>
          <button className="queue-link" onClick={() => act(api.queue.clear(conversationId), 'Clear queue')}>Clear</button>
        </div>
      )}
      {q.items.map((m) => (
        <div key={m.id} className="queue-item">
          <Icon name="queue" size="sm" className="queue-icon" />
          {editing === m.id
            ? <textarea
                className="queue-edit" autoFocus rows={Math.min(6, draft.split('\n').length)} value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => saveEdit(m)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m) }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                }}
              />
            : <span className="queue-text" title={m.text}>{m.text}</span>}
          {(m.input.attachments?.length ?? 0) > 0 && <span className="queue-meta" title={m.input.attachments!.map((a) => a.path).join('\n')}>+{m.input.attachments!.length} file{m.input.attachments!.length > 1 ? 's' : ''}</span>}
          <span className="queue-actions">
            <button className="queue-btn" onClick={() => act(api.queue.remove(conversationId, m.id), 'Remove queued message')} title="Remove" aria-label="Remove"><Icon name="trash" size="sm" /></button>
            <span className="queue-more">
              <button className="queue-btn" onClick={() => setMenu(menu === m.id ? null : m.id)} title="More" aria-label="More"><Icon name="more" size="sm" /></button>
              <Menu open={menu === m.id} onClose={() => setMenu(null)}>
                <MenuItem onClick={() => startEdit(m)}>Edit</MenuItem>
              </Menu>
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
