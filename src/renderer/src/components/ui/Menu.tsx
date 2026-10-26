import { useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The one popup menu (DS: Menu + Menu item). It closes on a click outside, Esc, or the window losing
// focus — without a full-window backdrop element, so no ancestor (transform, overflow, z-index) can
// shrink or hide the click-catcher (the sidebar bug of 2026-10-14). The click that closes it is
// swallowed, like a native menu, so it doesn't also activate whatever was under the pointer.

// Remember the element under the last pointerdown so a menu knows which button opened it; that button
// keeps its own toggle behaviour (a click on it closes the menu through its onClick).
let lastDown: Element | null = null
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { lastDown = e.target as Element }, true)

/** The visible area a menu must stay inside: the window, cut by any scrolling/clipping ancestor. */
function visibleBox(el: HTMLElement): { top: number; bottom: number } {
  let top = 0, bottom = window.innerHeight
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    if (getComputedStyle(a).overflowY === 'visible') continue
    const r = a.getBoundingClientRect()
    top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom)
  }
  return { top, bottom }
}

/** Not enough room below: open above the button that opened it, or else shift up to fit (D-137). */
function fitInView(el: HTMLElement, opener: Element | null): void {
  el.style.translate = ''
  const r = el.getBoundingClientRect()
  const box = visibleBox(el)
  const gap = 4
  if (r.bottom <= box.bottom - gap) return
  const t = opener?.getBoundingClientRect()
  let dy = t ? t.top - gap - r.bottom : box.bottom - gap - r.bottom      // flip above the opener
  if (r.top + dy < box.top + gap) dy = Math.max(box.bottom - gap - r.bottom, box.top + gap - r.top)   // too tall to flip: fit
  el.style.translate = `0 ${Math.round(dy)}px`
}

type Props = {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Visual class; defaults to the standard menu (`conv-menu`). */
  className?: string
  style?: CSSProperties
  /** Render into document.body (for menus that must escape a clipped or stacked parent). */
  portal?: boolean
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
}

export function Menu({ open, onClose, children, className = 'conv-menu', style, portal, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<Element | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    if (!open) return
    trigger.current = lastDown?.closest('button, [role="button"], [data-menu-trigger]') ?? null
    if (ref.current) fitInView(ref.current, trigger.current)
  }, [open])

  useEffect(() => {
    if (!open) return
    let unswallow: (() => void) | null = null
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || (trigger.current && trigger.current.contains(t))) return
      closeRef.current()
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); off() }
      const off = () => { window.removeEventListener('click', swallow, true); unswallow = null }
      window.addEventListener('click', swallow, true)
      window.addEventListener('pointerup', () => setTimeout(off, 0), { once: true, capture: true })
      unswallow = off
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() } }
    const onBlur = () => closeRef.current()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      // a pending swallow outlives the menu until the click lands (removed on pointerup)
      void unswallow
    }
  }, [open])

  if (!open) return null
  const el = <div ref={ref} className={className} style={style} role="menu" onClick={onClick}>{children}</div>
  return portal ? createPortal(el, document.body) : el
}

type ItemProps = ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }
export function MenuItem({ danger, className, type = 'button', ...rest }: ItemProps) {
  return <button type={type} role="menuitem" className={[danger ? 'danger' : '', className ?? ''].join(' ').trim() || undefined} {...rest} />
}
