import { useState } from 'react'
import Icon from './Icon'
import { Button } from './ui/Button'
import { describeFailure, type FailureAction, type FailureKind } from '../../../shared/failures'

// D-151 B: a failed reply in plain words — what happened, why, and what to do next.
// The agent's own error text stays one click away under Details.
const TONE: Record<FailureKind, 'danger' | 'warning' | 'info'> = { 'too-long': 'danger', limit: 'info', 'signed-out': 'warning', missing: 'warning', timeout: 'warning', network: 'warning', sandbox: 'warning', other: 'danger' }

interface Props {
  error: string
  agent: string            // the failed agent's name
  other?: string           // another agent that is on, for "Ask X instead"
  busy: boolean
  onAction: (a: FailureAction) => void
}

export default function FailureCard({ error, agent, other, busy, onAction }: Props) {
  const [details, setDetails] = useState(false)
  const f = describeFailure(error, agent, other)
  const label: Record<FailureAction, string> = {
    compress: 'Compress conversation', switch: `Ask ${other ?? 'another agent'} instead`, setup: 'Open Settings ▸ Agents',
    retry: 'Try again', continue: 'Continue from where it stopped', wait: 'Wait'
  }
  return (
    <div className={`fail-card fail-${TONE[f.kind]}`} role="alert">
      <Icon name="info" size="sm" />
      <div className="fail-text">
        <div className="fail-title">{f.title}</div>
        <div className="fail-body">{f.body}</div>
        <div className="fail-actions">
          {f.actions.map((a, i) => <Button key={a} size="sm" variant={i === 0 ? 'secondary' : 'ghost'} disabled={busy} onClick={() => onAction(a)}>{label[a]}</Button>)}
          <Button size="sm" variant="link" onClick={() => setDetails((v) => !v)} aria-expanded={details}>{details ? 'Hide details' : 'Details'}</Button>
        </div>
        {details && <pre className="fail-details">{f.details}</pre>}
      </div>
    </div>
  )
}
