import { Badge } from './ui/Badge'
import { confirmDialog } from './ui/ConfirmDialog'
import { useState } from 'react'
import type { CollabRun, CollabTaskKind, CollabTaskStatus, ProviderId, ProviderInfo } from '../../../shared/types'
import { presetsFor, modelLists, disabledModelSet } from '../models'
import { rowsFromTasks, draftsFromRows, type PlanRow } from '../../../shared/collabPlan'
import { resolveTaskModel } from '../../../shared/models'
import Icon from './Icon'
import { api } from '../api'
import { Button } from './ui/Button'

const statusIcon = (s: CollabTaskStatus): JSX.Element => {
  if (s === 'in_progress') return <span className="activity-spinner spinner-xs" />
  if (s === 'passed') return <span className="collab-chip pass">✓</span>
  if (s === 'failed') return <span className="collab-chip fail">✗</span>
  if (s === 'skipped') return <span className="collab-chip skip">–</span>
  return <span className="collab-chip pending">○</span>
}

// Older runs stored reviewer findings as objects; coerce so they never crash the
// renderer ("Objects are not valid as a React child").
const findingText = (f: unknown): string => {
  if (typeof f === 'string') return f
  if (f && typeof f === 'object') {
    const o = f as Record<string, unknown>
    const main = o.finding ?? o.issue ?? o.text ?? o.message ?? o.description ?? o.title ?? o.summary
    if (typeof main === 'string') return main
    try { return JSON.stringify(f) } catch { return String(f) }
  }
  return String(f)
}

const RUN_LABEL: Record<string, string> = {
  planning: 'Planning…',
  awaiting_confirmation: 'Review the plan',
  running: 'Running',
  needs_attention: 'Needs your attention',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed'
}

export default function CollabCard({ run, providers, onOpenFile }: { run: CollabRun; providers: ProviderInfo[]; onOpenFile?: (rel: string) => void }): JSX.Element {
  const tasks = run.tasks ?? []
  const [draft, setDraft] = useState<PlanRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const editing = run.status === 'awaiting_confirmation'
  // Rows keep a stable key and their dependencies, so editing the plan (e.g. moving a
  // task to Codex) no longer wipes "waits for" links (D-064).
  const rows: PlanRow[] = draft ?? rowsFromTasks(tasks)
  const setRow = (i: number, patch: Partial<PlanRow>) => setDraft(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () => setDraft([...rows, { key: `new-${Date.now()}`, title: '', kind: 'work', scope: '', acceptance: '', dependsOn: [] }])
  const delRow = (i: number) => setDraft(rows.filter((_, idx) => idx !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= rows.length) return
    const c = [...rows]; const tmp = c[i]; c[i] = c[j]; c[j] = tmp; setDraft(c)
  }

  const confirm = async () => { setBusy(true); try { await api.collab.confirmPlan(run.id, draft ? draftsFromRows(draft) : undefined) } finally { setBusy(false) } }
  const stop = async () => { setBusy(true); try { await api.collab.stop(run.id) } finally { setBusy(false) } }
  const confirmStop = async () => { if (!(await confirmDialog({ title: 'Stop this Collab run?', message: "It can't be resumed — you'd start over.", confirmLabel: 'Stop run' }))) return; await stop() }
  const resume = async (raiseBudget?: boolean) => { setBusy(true); try { await api.collab.resume(run.id, raiseBudget ? { raiseBudget: true } : undefined) } finally { setBusy(false) } }

  const spent = run.spent?.runs ?? 0
  const cap = run.budget?.maxRuns ?? 0

  return (
    <div className={`collab-card status-${run.status}`}>
      <div className="collab-card-head">
        <Icon name="flash" size="sm" />
        <span className="collab-card-title">Collab · {RUN_LABEL[run.status] ?? run.status}</span>
        {(run.status === 'running' || run.status === 'planning') && <span className="activity-spinner spinner-xs" />}
        <span className="collab-card-spacer" />
        {cap > 0 && (run.status === 'running' || run.status === 'needs_attention') && (
          <span className="collab-budget" title="Agent runs used vs. budget">{spent}/{cap} runs</span>
        )}
        {(run.status === 'running' || run.status === 'planning') && (
          <Button size="sm" onClick={confirmStop} disabled={busy}>Stop</Button>
        )}
      </div>

      <div className="collab-goal">{run.goal}</div>

      {/* D-064: PLAN/STATUS live in the hidden .workbench/ folder, so link them here;
          deliverables are in a visible folder the file browser shows. */}
      {run.status !== 'planning' && (
        <div className="collab-links">
          {onOpenFile && <Button variant="link" onClick={() => onOpenFile(`.workbench/collab/${run.id}/PLAN.md`)}>Plan</Button>}
          {onOpenFile && <Button variant="link" onClick={() => onOpenFile(`.workbench/collab/${run.id}/STATUS.md`)}>Status log</Button>}
          {run.outputDir && (
            <Button variant="link" title="Show in Finder" onClick={() => { void api.system.revealItem(run.projectCwd, run.outputDir) }}>
              Deliverables: {run.outputDir}/
            </Button>
          )}
        </div>
      )}

      {run.status === 'planning' && <div className="collab-note">Drafting a plan…</div>}

      {(run.status === 'failed' || run.status === 'stopped') && run.reason && (
        <div className="collab-reason">{run.reason}</div>
      )}

      {run.status === 'needs_attention' && (
        <div className="collab-reason warn">{run.reason || 'Paused.'}</div>
      )}

      {tasks.length > 0 && !editing && (
        <ol className="collab-tasks">
          {tasks.map((t) => (
            <li key={t.id} className={`collab-task ${t.status}`}>
              <span className="collab-task-status">{statusIcon(t.status)}</span>
              <span className="collab-task-body">
                <span className="collab-task-title">{t.title} {t.kind === 'review' && <span className="collab-kind">review</span>}{(t.provider || t.model) && (() => {
                  const pid = (t.provider ?? run.providerId) as ProviderId
                  const pname = providers.find((p) => p.id === pid)?.name ?? pid
                  const mv = resolveTaskModel(run.providerId, run.model, t.provider, t.model, modelLists(), disabledModelSet())
                  const mlabel = presetsFor(pid).find((m) => m.v === mv)?.l ?? 'Default'
                  return <Badge className="collab-agent-badge">{pname} · {mlabel}</Badge>
                })()}</span>
                {t.status === 'failed' && t.lastVerdict?.findings?.length ? (
                  <ul className="collab-findings">{t.lastVerdict.findings.map((f, i) => <li key={i}>{findingText(f)}</li>)}</ul>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {editing && (
        <div className="collab-plan-edit">
          {rows.map((r, i) => (
            <div key={r.key} className="collab-plan-row">
              <div className="collab-plan-row-top">
                <span className="collab-plan-num">{i + 1}</span>
                <input className="collab-ti" value={r.title ?? ''} placeholder="Task title" onChange={(e) => setRow(i, { title: e.target.value })} />
                <select className="collab-kind-sel" value={r.kind ?? 'work'} onChange={(e) => setRow(i, { kind: e.target.value as CollabTaskKind })}>
                  <option value="work">work</option>
                  <option value="review">review</option>
                </select>
                <div className="collab-row-tools">
                  <button className="collab-move" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="collab-move" title="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
                  <button className="collab-move danger" title="Delete" onClick={() => delRow(i)}>✕</button>
                </div>
              </div>
              <label className="collab-flabel">Scope</label>
              <textarea className="collab-ta" rows={2} value={r.scope ?? ''} placeholder="Files or area this task owns" onChange={(e) => setRow(i, { scope: e.target.value })} />
              {(() => {
                const waits = (r.dependsOn ?? []).map((k) => rows.findIndex((x) => x.key === k)).filter((n) => n >= 0 && n !== i)
                return waits.length
                  ? <div className="collab-flabel collab-agent-note">Waits for {waits.map((n) => `#${n + 1}`).join(', ')} to pass <Button variant="link" onClick={() => setRow(i, { dependsOn: [] })}>Clear</Button></div>
                  : null
              })()}
              <label className="collab-flabel">Acceptance</label>
              <textarea className="collab-ta" rows={2} value={r.acceptance ?? ''} placeholder="How we know it's done and correct" onChange={(e) => setRow(i, { acceptance: e.target.value })} />
              {(r.kind ?? 'work') === 'review'
                ? <div className="collab-flabel collab-agent-note">Uses the strong reviewer model.</div>
                : <>
                    <label className="collab-flabel">Agent</label>
                    <div className="collab-agent-row">
                      <select className="collab-kind-sel" value={r.provider ?? ''} onChange={(e) => setRow(i, { provider: (e.target.value || undefined) as ProviderId | undefined, model: undefined })}>
                        <option value="">Default</option>
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select className="collab-kind-sel" value={r.model ?? ''} onChange={(e) => setRow(i, { model: e.target.value || undefined })}>
                        {presetsFor((r.provider ?? run.providerId) as ProviderId).map((m) => <option key={m.v} value={m.v}>{m.v ? m.l : `${providers.find((p) => p.id === (r.provider ?? run.providerId))?.name ?? ''} default`.trim()}</option>)}
                      </select>
                    </div>
                    {r.provider === 'codex' && presetsFor('codex').length === 1 && (
                      <div className="field-hint">Add Codex models in Settings ▸ Agents to pick one.</div>
                    )}
                  </>}
            </div>
          ))}
          <Button size="sm" className="collab-add" onClick={addRow}><Icon name="plus" size="sm" />Add task</Button>
          {draft && <div className="field-hint">Runs top to bottom; the review runs last.</div>}
          <div className="collab-plan-actions">
            <Button size="sm" onClick={stop} disabled={busy}>Reject</Button>
            <Button variant="primary" size="sm" onClick={confirm} disabled={busy || rows.length === 0}>
              {busy ? <><span className="activity-spinner spinner-xs" />Starting</> : 'Confirm & run'}
            </Button>
          </div>
        </div>
      )}

      {run.status === 'needs_attention' && (
        <div className="collab-plan-actions">
          <Button size="sm" onClick={confirmStop} disabled={busy}>Stop</Button>
          <Button size="sm" onClick={() => resume(true)} disabled={busy}>Raise budget & resume</Button>
          <Button variant="primary" size="sm" onClick={() => resume(false)} disabled={busy}>Resume</Button>
        </div>
      )}

      {run.status === 'done' && (() => {
        const anyFailed = tasks.some((t) => t.status === 'failed')
        return <div className={`collab-summary${anyFailed ? ' warn' : ''}`}>{anyFailed ? '⚠' : '✓'} {run.summary || 'Collab run complete.'}</div>
      })()}
    </div>
  )
}
