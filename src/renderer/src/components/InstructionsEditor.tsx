import { useState } from 'react'
import Modal from './Modal'

interface Props {
  initial: string
  onSave: (value: string) => void
  onClose: () => void
}

export default function InstructionsEditor({ initial, onSave, onClose }: Props) {
  const [value, setValue] = useState(initial)
  return (
    <Modal
      title="Project Instructions"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(value)}>Save</button>
        </>
      }
    >
      <textarea
        className="field-textarea"
        autoFocus
        value={value}
        placeholder={'# Project Instructions\n\nYou are working on ...'}
        onChange={(e) => setValue(e.target.value)}
      />
    </Modal>
  )
}
