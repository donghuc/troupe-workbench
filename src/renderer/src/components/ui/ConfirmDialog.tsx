import { useEffect, useState, type ReactNode } from 'react'
import Modal from '../Modal'
import { Button } from './Button'
import Icon, { type IconName } from '../Icon'

// DS: Modal used as a confirmation. Replaces window.confirm(), which shows an OS sheet that ignores
// the app's theme and type. Call confirmDialog() anywhere; <ConfirmHost /> (mounted once in App)
// renders it. Without a host (e.g. a window that doesn't mount one) it falls back to window.confirm.

export type ConfirmOptions = {
  title: string
  message?: ReactNode
  /** Label of the confirming button, e.g. "Delete". Defaults to "OK". */
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive: the confirm button is danger-coloured with an icon. Defaults to true for
   *  Delete / Remove / Clear / Reset / Stop / Discard labels. */
  danger?: boolean
}
type Request = ConfirmOptions & { resolve: (ok: boolean) => void }

// A destructive confirm is never the accent primary: danger colour, always with an icon and its label.
const DESTRUCTIVE = /^(delete|remove|clear|reset|stop|discard)\b/i
const dangerIcon = (label: string): IconName => /^reset/i.test(label) ? 'refresh' : /^stop/i.test(label) ? 'stop' : 'trash'

let enqueue: ((r: Request) => void) | null = null

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!enqueue) {
    const text = [opts.title, typeof opts.message === 'string' ? opts.message : ''].filter(Boolean).join('\n\n')
    return Promise.resolve(window.confirm(text))
  }
  return new Promise((resolve) => enqueue!({ ...opts, resolve }))
}

export function ConfirmHost() {
  const [queue, setQueue] = useState<Request[]>([])
  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r])
    return () => { enqueue = null }
  }, [])
  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    // Esc cancels only the confirmation, not a modal or menu underneath it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  if (!cur) return null
  function done(ok: boolean) { cur.resolve(ok); setQueue((q) => q.slice(1)) }
  const label = cur.confirmLabel ?? 'OK'
  const danger = cur.danger ?? DESTRUCTIVE.test(label)
  return (
    <Modal
      narrow
      top
      dismissOnBackdrop
      title={cur.title}
      onClose={() => done(false)}
      footer={<>
        <Button onClick={() => done(false)}>{cur.cancelLabel ?? 'Cancel'}</Button>
        {danger
          ? <Button danger autoFocus className="btn-icon-label" onClick={() => done(true)}><Icon name={dangerIcon(label)} size="sm" />{label}</Button>
          : <Button variant="primary" autoFocus onClick={() => done(true)}>{label}</Button>}
      </>}
    >
      {cur.message && <p className="confirm-message">{cur.message}</p>}
    </Modal>
  )
}
