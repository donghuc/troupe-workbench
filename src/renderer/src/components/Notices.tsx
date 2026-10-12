import { useState } from 'react'
import { useNotices, dismissNotice, type Notice } from '../notices'

function NoticeRow({ n }: { n: Notice }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { if (!n.details) return; try { await navigator.clipboard.writeText(n.details); setCopied(true) } catch { /* ignore */ } }
  return (
    <div className={`toast${n.kind === 'error' ? ' toast-error' : ''}`} role={n.kind === 'error' ? 'alert' : 'status'}>
      <span>{n.text}</span>
      {n.details && <button className="link-btn" onClick={copy}>{copied ? 'Copied' : 'Copy details'}</button>}
      <button className="link-btn" onClick={() => dismissNotice(n.id)}>Dismiss</button>
    </div>
  )
}

export default function Notices() {
  const list = useNotices()
  if (!list.length) return null
  return <div className="toast-stack">{list.map((n) => <NoticeRow key={n.id} n={n} />)}</div>
}
