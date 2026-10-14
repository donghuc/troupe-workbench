import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api } from '../api'
import type { ContextCheckReport } from '../../../shared/api'
import { providerLabel } from '../../../shared/providers'
import { Button } from './ui/Button'

// Check context (D-082): does a fresh chat know what this project decided? Two short
// runs; results are shown per decision with what the fresh chat actually answered.
export default function ContextCheckModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [report, setReport] = useState<ContextCheckReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = () => { setReport(null); setError(null); api.outcomes.check(projectId).then(setReport).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))) }
  useEffect(run, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Check context" onClose={onClose} footer={<>{(report || error) && <Button onClick={run}>Run again</Button>}<Button onClick={onClose}>Close</Button></>}>
      {!report && !error && <div className="outcome-drafting"><span className="activity-spinner" /> Asking a fresh chat what this project has decided…</div>}
      {error && <div className="mcp-error">⚠ {error}</div>}
      {report && (
        <>
          <p className={`check-summary ${report.passed === report.total ? 'ok' : ''}`}>
            {report.passed} of {report.total} answered correctly by a fresh {providerLabel(report.agent)} chat with this project’s context.
          </p>
          {report.results.map((r) => (
            <div key={r.id} className={`check-row ${r.ok ? 'ok' : 'miss'}`}>
              <div className="check-head"><span className="check-mark">{r.ok ? '✓' : '✗'}</span><span className="check-id">{r.id}</span><span className="check-q truncate" title={r.question}>{r.expected.split(' — ')[0]}</span></div>
              {!r.ok && <div className="check-detail"><b>Fresh chat said:</b> {r.answer || '(nothing)'}{r.note ? <><br /><b>Missing:</b> {r.note}</> : null}</div>}
            </div>
          ))}
          {report.passed < report.total && <p className="field-hint">A miss usually means a terse entry or a memory line that contradicts it. Sharpen it and run again.</p>}
        </>
      )}
    </Modal>
  )
}
