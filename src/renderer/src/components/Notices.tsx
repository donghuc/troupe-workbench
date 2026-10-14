import { useState } from 'react'
import { useNotices, dismissNotice, type Notice } from '../notices'
import { Button } from './ui/Button'

function NoticeRow({ n }: { n: Notice }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { if (!n.details) return; try { await navigator.clipboard.writeText(n.details); setCopied(true) } catch { /* ignore */ } }
  return (
    <div className={`toast${n.kind === 'error' ? ' toast-error' : ''}`} role={n.kind === 'error' ? 'alert' : 'status'}>
      <span>{n.text}</span>
      {n.details && <Button variant="link" onClick={copy}>{copied ? 'Copied' : 'Copy details'}</Button>}
      <Button variant="link" onClick={() => dismissNotice(n.id)}>Dismiss</Button>
    </div>
  )
}

export default function Notices() {
  const list = useNotices()
  if (!list.length) return null
  return <div className="toast-stack">{list.map((n) => <NoticeRow key={n.id} n={n} />)}</div>
}
