import { useState } from 'react'
import Modal from './Modal'
import type { NewProjectInput } from '../../../shared/types'
import { Button } from './ui/Button'

interface Props {
  onCreate: (input: NewProjectInput) => void
  onClose: () => void
}

export default function NewProjectModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const canCreate = name.trim().length > 0

  const submit = () => { if (canCreate) onCreate({ name, description }) }

  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canCreate} onClick={submit}>Create</Button>
        </>
      }
    >
      <label className="field-label">Name</label>
      <input
        className="field-input"
        autoFocus
        value={name}
        placeholder="e.g. SafeNest"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />
      <label className="field-label">Description</label>
      <input
        className="field-input"
        value={description}
        placeholder="Optional one-line description"
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />
    </Modal>
  )
}
