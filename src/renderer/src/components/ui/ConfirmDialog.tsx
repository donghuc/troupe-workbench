import { useEffect, useState, type ReactNode } from 'react'
import Modal from '../Modal'
import { Button } from './Button'

// DS: Modal used as a confirmation. Replaces window.confirm(), which shows an OS sheet that ignores
// the app's theme and type. Call confirmDialog() anywhere; <ConfirmHost /> (mounted once in App)
// renders it. Without a host (e.g. a window that doesn't mount one) it falls back to window.confirm.

export type ConfirmOptions = {
  title: string
  message?: ReactNode
  /** Label of the confirming button, e.g. "Delete". Defaults to "OK". */
  confirmLabel?: string
  cancelLabel?: string
}
type Request = ConfirmOptions & { resolve: (ok: boolean) => void }

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
  return (
    <Modal
      narrow
      title={cur.title}
      onClose={() => done(false)}
      footer={<>
        <Button onClick={() => done(false)}>{cur.cancelLabel ?? 'Cancel'}</Button>
        <Button variant="primary" autoFocus onClick={() => done(true)}>{cur.confirmLabel ?? 'OK'}</Button>
      </>}
    >
      {cur.message && <p className="confirm-message">{cur.message}</p>}
    </Modal>
  )
}
