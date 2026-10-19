import { useRef, type KeyboardEvent, type ReactNode } from 'react'

// DS: Segmented — Size (md / sm). A sunken track with the chosen segment raised.
// One choice from 2–4 short options (theme, sort, view mode). Styling: .segmented in app.css.
// Pass className only for placement (margins, alignment). Arrow keys move the choice.
export interface SegmentOption<T extends string> { value: T; label: ReactNode; disabled?: boolean; title?: string }

interface Props<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string                 // accessible name of the group
  size?: 'md' | 'sm'
  className?: string
}

export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', className }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step || !enabled.length) return
    e.preventDefault()
    const at = enabled.indexOf(i)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div className={`segmented segmented-${size}${className ? ' ' + className : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={on}
            tabIndex={on ? 0 : -1} disabled={o.disabled} title={o.title}
            className={`segmented-btn${on ? ' active' : ''}`}
            onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
