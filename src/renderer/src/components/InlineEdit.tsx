import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  placeholder?: string
  className?: string
  as?: 'title' | 'desc'
  onCommit: (value: string) => void
}

// Click to edit; Enter or blur commits; Escape cancels.
export default function InlineEdit({ value, placeholder, className, as = 'title', onCommit }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== value && (as !== 'title' || next.length > 0)) onCommit(next)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className={`inline-edit inline-edit-${as} ${className ?? ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
      />
    )
  }
  return (
    <span
      className={`inline-edit-display inline-edit-${as} ${className ?? ''} ${!value ? 'is-placeholder' : ''}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  )
}
