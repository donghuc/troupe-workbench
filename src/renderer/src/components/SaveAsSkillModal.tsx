import { useState } from 'react'
import Modal from './Modal'
import { api } from '../api'
import { reportError } from '../notices'
import type { SkillScope } from '../../../shared/types'
import { Button } from './ui/Button'

interface Props {
  content: string
  cwd?: string
  onClose: () => void
  onSaved: () => void
}

// Turn a good reply into a reusable skill (agent-authored polish #1).
export default function SaveAsSkillModal({ content, cwd, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggers, setTriggers] = useState('')
  const [body, setBody] = useState(content.trim())
  const [scope, setScope] = useState<SkillScope>('global')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const ok: boolean = await api.skills.create(
      { name, description, triggers, body, scope: scope === 'project' && cwd ? 'project' : 'global' },
      scope === 'project' ? cwd : undefined
    ).then(() => true, (e: unknown) => { reportError('Save skill', e); return false })
    setBusy(false)
    if (ok) onSaved()
  }

  return (
    <Modal title="Save as skill" onClose={onClose} footer={<>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" disabled={!name.trim() || !body.trim() || busy} onClick={save}>Save skill</Button>
    </>}>
      <label className="field-label">Name</label>
      <input className="field-input" autoFocus value={name} placeholder="e.g. Portfolio review" onChange={(e) => setName(e.target.value)} />
      <label className="field-label">Description <span className="field-optional">(when to use it)</span></label>
      <input className="field-input" value={description} placeholder="e.g. Review a portfolio and flag rebalancing actions" onChange={(e) => setDescription(e.target.value)} />
      <label className="field-label">Instructions</label>
      <textarea className="field-textarea" value={body} onChange={(e) => setBody(e.target.value)} />
      <label className="field-label">Auto-apply triggers <span className="field-optional">(optional)</span></label>
      <input className="field-input" value={triggers} placeholder="e.g. portfolio, rebalance" onChange={(e) => setTriggers(e.target.value)} />
      <label className="field-label">Scope</label>
      <select className="field-input" value={scope} onChange={(e) => setScope(e.target.value as SkillScope)}>
        <option value="global">Global — all projects</option>
        {cwd && <option value="project">This project only</option>}
      </select>
    </Modal>
  )
}
