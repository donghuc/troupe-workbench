import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api } from '../api'
import type { MirrorResult } from '../../../shared/types'

interface Props {
  folderPath: string | null
  dbInitial: string
  append?: string | null
  onSaveDb: (value: string) => void
  onClose: () => void
}

// For a folder-backed project, memory is the folder's CLAUDE.md (mirrored to
// AGENTS.md on save). Folderless projects fall back to the DB `memory` field.
export default function MemoryEditor({ folderPath, dbInitial, append, onSaveDb, onClose }: Props) {
  const [value, setValue] = useState(dbInitial)
  const [loaded, setLoaded] = useState(!folderPath)
  // A skipped AGENTS.md mirror keeps the modal open so the result isn't silent (D-055).
  const [mirror, setMirror] = useState<MirrorResult | null>(null)
  const [adopting, setAdopting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const seed = (base: string) => {
      const next = append ? (base.trim() ? base.trimEnd() + '\n\n' : '') + append : base
      if (!cancelled) { setValue(next); setLoaded(true) }
    }
    if (folderPath) {
      api.projectMemory.read(folderPath).then((file: string | null) => seed(file ?? dbInitial)).catch(() => seed(dbInitial))
    } else {
      seed(dbInitial)
    }
    return () => { cancelled = true }
    /* eslint-disable-next-line */
  }, [folderPath])

  const save = async () => {
    if (folderPath) {
      const result = await api.projectMemory.write(folderPath, value)
      if (!result.mirrored) { setMirror(result); return }   // stay open and explain
    } else {
      onSaveDb(value)
    }
    onClose()
  }

  // One-time, explicit: fold the hand-written AGENTS.md into CLAUDE.md, then mirror.
  const adopt = async () => {
    if (!folderPath) return
    setAdopting(true)
    try {
      setValue(await api.projectMemory.adopt(folderPath))
      setMirror(null)
    } finally {
      setAdopting(false)
    }
  }

  return (
    <Modal
      title="Project Memory"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{mirror ? 'Close' : 'Cancel'}</button>
        <button className="btn btn-primary" onClick={save} disabled={!loaded}>Save</button>
      </>}
    >
      {mirror && (
        <div className="mem-mirror-note">
          <span>
            {mirror.reason === 'unreadable'
              ? 'Saved. Workbench could not read the AGENTS.md here, so it will inject this memory for Codex instead of mirroring it.'
              : 'Saved. Codex has its own AGENTS.md here, so Workbench will inject this memory for Codex instead of mirroring it.'}
          </span>
          <button className="btn btn-sm" onClick={adopt} disabled={adopting}>
            {adopting ? 'Adopting…' : 'Adopt AGENTS.md'}
          </button>
        </div>
      )}
      <textarea
        className="field-textarea"
        autoFocus
        value={value}
        placeholder={'# Project Memory\n\n## Current Decisions\n- …\n\n## Current Work\n- …'}
        onChange={(e) => setValue(e.target.value)}
      />
    </Modal>
  )
}
