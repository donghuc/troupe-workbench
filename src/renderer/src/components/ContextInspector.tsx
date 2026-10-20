import { Badge } from './ui/Badge'
import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api } from '../api'
import type { ProviderId } from '../../../shared/types'
import type { ContextInspection, ContextSection } from '../../../shared/agent'
import { providerLabel } from '../../../shared/providers'
import { Button } from './ui/Button'

interface Props {
  conversationId: string
  providerId: ProviderId
  onClose: () => void
}

// What each badge means (D-055): native sections are read by the CLI itself from
// its own file, so Workbench does not send them and they are not in the estimate.
const badge = (s: ContextSection): { label: string; cls: string } | null => {
  switch (s.delivery) {
    case 'native': return { label: `Loaded natively from ${s.source ?? 'the provider file'}`, cls: 'native' }
    case 'injected': return { label: 'Injected by Workbench', cls: 'injected' }
    case 'none': return { label: 'Not delivered', cls: 'none' }
    default: return null
  }
}

export default function ContextInspector({ conversationId, providerId, onClose }: Props) {
  const [data, setData] = useState<ContextInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.context.inspect(conversationId, providerId).then(setData)
  useEffect(() => { load() }, [conversationId, providerId])
  const compressNow = async () => { setBusy(true); await api.conversations.compressNow(conversationId); await load(); setBusy(false) }

  const providerName = providerLabel(providerId, 'Claude')

  return (
    <Modal title={`Context for the next message · ${providerName}`} onClose={onClose} footer={<><Button disabled={busy} onClick={compressNow}>{busy ? 'Compressing…' : 'Compress now'}</Button><Button onClick={onClose}>Close</Button></>}>
      {!data && <p className="field-hint">Calculating…</p>}
      {data && data.sections.map((s) => {
        const b = badge(s)
        return (
          <div key={s.name} className="ctx-section">
            <div className="ctx-section-head">
              <span className="ctx-name">{s.name}</span>
              {b && <Badge className="ctx-badge" tone={b.cls === 'injected' ? 'info' : 'neutral'} appearance={b.cls === 'none' ? 'outline' : 'soft'}>{b.label}</Badge>}
              <span className="ctx-size">{s.chars.toLocaleString()} chars · ~{s.approxTokens.toLocaleString()} tokens</span>
            </div>
            {s.warning && <p className="ctx-warning">{s.warning}</p>}
            {s.note && <p className="field-hint">{s.note}</p>}
            {s.chars > 0 && <pre className="ctx-preview">{s.content}</pre>}
          </div>
        )
      })}
      {data && (
        <>
          {/* What this run may read and edit on disk (D-054). Additional folders are
              read-write in Auto (amends D-002), so the inspector says so plainly. */}
          <div className="ctx-folders">
            <span className="ctx-folders-label">Folders this run can touch</span>
            <div className="ctx-folder-row">
              <span className="ctx-folder-tag">primary</span>
              <span className="truncate">{data.folders.primary ?? 'No folder — runs in a temporary directory'}</span>
            </div>
            {data.folders.extra.map((f) => (
              <div key={f} className="ctx-folder-row">
                <span className="ctx-folder-tag">added</span>
                <span className="truncate">{f}</span>
              </div>
            ))}
            {data.folders.missing.map((f) => (
              <div key={f} className="ctx-folder-row ctx-folder-missing">
                <span className="ctx-folder-tag">skipped</span>
                <span className="truncate">{f} — no longer a folder</span>
              </div>
            ))}
          </div>
          <div className="ctx-total">
            Estimated total: {data.totalChars.toLocaleString()} chars · ~{data.totalApproxTokens.toLocaleString()} tokens
            <span className="ctx-total-note"> — excludes what {providerName} loads natively.</span>
          </div>
          <p className="field-hint">Skills and attachments are added at send time.</p>
        </>
      )}
    </Modal>
  )
}
