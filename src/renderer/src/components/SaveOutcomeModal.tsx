import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { api } from '../api'
import { reportError } from '../notices'
import { OUTCOME_KINDS, type Outcome, type OutcomeKind } from '../../../shared/decisions'

interface Props {
  conversationId: string
  projectId: string
  messageId?: string
  onClose: () => void
  onSaved: (o: Outcome) => void
}

// Save outcome (D-081 step 6). The drafting agent fills the record in; the normal path is
// glance → Save. Every field is editable, nothing is required beyond the title, and the
// type is pre-selected. A contradiction with memory or an earlier entry is shown, not enforced.
// A textarea that grows with its content (up to a cap), so nothing hides behind a scrollbar.
function GrowingArea({ value, onChange, className = '', min = 2, max = 12, autoFocus }: { value: string; onChange: (v: string) => void; className?: string; min?: number; max?: number; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20
    const pad = 16
    el.style.height = `${Math.min(Math.max(el.scrollHeight, line * min + pad), line * max + pad)}px`
  }, [value, min, max])
  return <textarea ref={ref} className={`field-input outcome-area ${className}`} rows={min} autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} />
}

export default function SaveOutcomeModal({ conversationId, projectId, messageId, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setError(null); setDraft(null)
    api.outcomes.draft(conversationId, messageId).then(setDraft).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [conversationId, messageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Outcome>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const save = async () => {
    if (!draft?.title.trim()) return
    setBusy(true)
    try { onSaved(await api.outcomes.save(projectId, draft)) } catch (e) { reportError('Save outcome', e) } finally { setBusy(false) }
  }

  return (
    <Modal title="Save outcome" wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      {error && <button className="btn" onClick={load}>Try again</button>}
      <button className="btn btn-primary" disabled={!draft?.title.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save to log'}</button>
    </>}>
      {!draft && !error && <div className="outcome-drafting"><span className="activity-spinner" /> Drafting the record from this exchange…</div>}
      {error && <div className="mcp-error">⚠ {error}</div>}
      {draft && (
        <>
          <label className="field-label">What kind of outcome is this?</label>
          <div className="outcome-kinds" role="radiogroup" aria-label="Kind">
            {OUTCOME_KINDS.map((k) => (
              <button key={k.v} type="button" role="radio" aria-checked={draft.kind === k.v} className={`model-chip${draft.kind === k.v ? ' on' : ''}`} onClick={() => set({ kind: k.v as OutcomeKind })}>{k.l}</button>
            ))}
          </div>
          <p className="field-hint outcome-kind-hint">{draft.kind === 'decision' ? 'A choice made between options — agents follow it unless the reason no longer holds.' : draft.kind === 'insight' ? 'Something learned that stays true — background agents can rely on.' : 'Left unresolved on purpose — agents know it is still open.'}</p>
          {draft.conflicts && <div className="outcome-conflict">⚠ {draft.conflicts}</div>}
          <label className="field-label">{draft.kind === 'question' ? 'Question' : draft.kind === 'insight' ? 'Insight' : 'Decision'}</label>
          <GrowingArea className="outcome-title" autoFocus value={draft.title} onChange={(v) => set({ title: v })} />
          <label className="field-label">Why</label>
          <GrowingArea value={draft.why ?? ''} onChange={(v) => set({ why: v })} />
          <label className="field-label">Considered <span className="field-optional">(alternatives, who argued what)</span></label>
          <GrowingArea value={draft.considered ?? ''} onChange={(v) => set({ considered: v })} />
          <label className="field-label">Open <span className="field-optional">(still unsettled)</span></label>
          <GrowingArea value={draft.open ?? ''} onChange={(v) => set({ open: v })} />
          <p className="field-hint">Will be saved as an entry dated {draft.date} in the project’s DECISIONS.md, from the chat “{draft.source}”. Every agent gets the log with each message.</p>
        </>
      )}
    </Modal>
  )
}
