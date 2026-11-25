import type { ReactNode } from 'react'
import Icon from './Icon'

// D-151 D: one shape for everything that waits for you (pattern "Human in the loop"):
// the state, the exact action, the facts (who asked, what it will do, its limits, how to undo),
// the exact payload, then the buttons. Approved, it stays as a one-line record.
export interface ApprovalFact { label: string; value: ReactNode }

export function ApprovalHead({ state, action }: { state: 'waiting' | 'approved'; action: ReactNode }) {
  return (
    <>
      <div className={`appr-state appr-${state}`}><Icon name={state === 'waiting' ? 'clock' : 'check'} size="sm" />{state === 'waiting' ? 'Waiting for you' : 'Approved'}</div>
      <div className="appr-action">{action}</div>
    </>
  )
}

export function ApprovalFacts({ facts }: { facts: ApprovalFact[] }) {
  return (
    <dl className="appr-facts">
      {facts.map((f) => <div key={f.label} className="appr-fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
    </dl>
  )
}

interface Props {
  action: ReactNode
  facts: ApprovalFact[]
  payload?: { label: string; body: ReactNode }
  children: ReactNode          // the buttons
  label?: string
}

export default function ApprovalCard({ action, facts, payload, children, label = 'Waiting for your approval' }: Props) {
  return (
    <div className="appr-card" role="region" aria-label={label}>
      <ApprovalHead state="waiting" action={action} />
      <ApprovalFacts facts={facts} />
      {payload && <div className="appr-payload"><div className="appr-payload-label">{payload.label}</div><div className="appr-payload-body">{payload.body}</div></div>}
      <div className="appr-buttons">{children}</div>
    </div>
  )
}

/** The record left after approving. */
export function ApprovedLine({ text }: { text: string }) {
  return <div className="appr-record"><Icon name="check" size="sm" />{text}</div>
}
