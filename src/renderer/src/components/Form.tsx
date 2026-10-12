import type { ReactNode } from 'react'

// Form layout primitives. The rule: components never set outer margins; the parent
// owns the gaps. `Stack` spaces blocks (20px), `Field` spaces label / control / hint
// (8px), `Section` adds a small uppercase title over a Stack. Any settings tab or form
// is a Stack of Fields and Sections and inherits the rhythm without any extra CSS.

export function Stack({ children, tight, className }: { children: ReactNode; tight?: boolean; className?: string }) {
  return <div className={`stack${tight ? ' stack-tight' : ''}${className ? ` ${className}` : ''}`}>{children}</div>
}

export function Field({ label, hint, htmlFor, children }: { label?: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="field">
      {label && <label className="field-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

export function Section({ title, actions, dim, children }: { title: ReactNode; actions?: ReactNode; dim?: boolean; children: ReactNode }) {
  return (
    <section className="form-section">
      <div className={`settings-section-label${actions ? ' settings-section-row' : ''}${dim ? ' dim' : ''}`}>
        {actions ? <><span>{title}</span><span className="side-actions">{actions}</span></> : title}
      </div>
      <Stack>{children}</Stack>
    </section>
  )
}
