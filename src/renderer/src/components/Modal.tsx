import { ReactNode, useEffect, useRef } from 'react'

// Open modals, innermost last. Esc closes only the innermost one, so Esc in "Add agent"
// (opened from Settings) doesn't also close Settings and lose its edits.
const openStack: object[] = []

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Small dialog (confirmations). */
  narrow?: boolean
  /** Close on a click on the dimmed backdrop. Off by default: a stray click outside a form
   *  (e.g. adding an agent in Settings) must not throw the work away. Esc and ✕ still close. */
  dismissOnBackdrop?: boolean
  /** Stack above every other modal (confirmations opened from inside one). */
  top?: boolean
}

export default function Modal({ title, onClose, children, footer, wide, narrow, dismissOnBackdrop, top }: Props) {
  // Only a click that both starts and ends on the backdrop counts — selecting text in a
  // field and releasing outside the card is not a dismiss.
  const downOnBackdrop = useRef(false)
  const self = useRef({})
  useEffect(() => {
    const me = self.current
    openStack.push(me)
    return () => { const i = openStack.lastIndexOf(me); if (i >= 0) openStack.splice(i, 1) }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && openStack[openStack.length - 1] === self.current) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={`modal-overlay${top ? ' top' : ''}`}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (dismissOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose() }}
    >
      <div className={`modal-card${wide ? ' wide' : ''}${narrow ? ' narrow' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
