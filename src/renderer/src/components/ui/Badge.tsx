import type { HTMLAttributes } from 'react'

// DS: Badge — Tone (Neutral / Accent / Success / Warning / Danger / Info) × Appearance (Outline / Soft).
// Pill, caption xs-medium. Styling: .badge in app.css. Pass className only for placement (margins).
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
type Props = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; appearance?: 'outline' | 'soft' }

export function Badge({ tone = 'neutral', appearance = 'outline', className, ...rest }: Props) {
  return <span className={`badge badge-${appearance} badge-${tone}${className ? ' ' + className : ''}`} {...rest} />
}
