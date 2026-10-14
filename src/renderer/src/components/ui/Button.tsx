import { forwardRef, type ButtonHTMLAttributes } from 'react'

// DS: Button (Primary / Secondary / Ghost / Link × Medium / Small) and Icon button.
// Styling lives in app.css (.btn, .btn-primary, .btn-ghost, .btn-sm, .link-btn, .icon-btn);
// use these components instead of writing the class strings by hand.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link'
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Destructive action: danger text colour. */
  danger?: boolean
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const buttonClass = ({ variant = 'secondary', size = 'md', danger, className }: Pick<Props, 'variant' | 'size' | 'danger' | 'className'>) =>
  variant === 'link'
    ? cx('link-btn', danger && 'danger', className)
    : cx('btn', variant === 'primary' && 'btn-primary', variant === 'ghost' && 'btn-ghost', size === 'sm' && 'btn-sm', danger && 'danger', className)

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant, size, danger, className, ...rest }, ref) {
  return <button ref={ref} className={buttonClass({ variant, size, danger, className })} {...rest} />
})

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { title: string }
/** Square 28px icon-only button. `title` is required: it is the accessible name and the tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ className, title, ...rest }, ref) {
  return <button ref={ref} className={cx('icon-btn', className)} title={title} aria-label={rest['aria-label'] ?? title} {...rest} />
})
