import { useState } from 'react'
import Modal from './Modal'
import { api } from '../api'

interface Props { folderPath: string; content: string; onClose: () => void }

export default function SaveToProject({ folderPath, content, onClose }: Props) {
  const [rel, setRel] = useState(`notes/reply-${new Date().toISOString().slice(0, 10)}.md`)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    try { await api.files.writeFile(folderPath, rel.trim(), content); setSaved(true); setTimeout(onClose, 700) }
    catch (e) { setError(String(e)) }
  }
  return (
    <Modal title="Save to project" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!rel.trim() || saved} onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
    </>}>
      <label className="field-label">File path</label>
      <input className="field-input" autoFocus value={rel} onChange={(e) => setRel(e.target.value)} />
      {error && <p className="msg-error">⚠ {error}</p>}
    </Modal>
  )
}
