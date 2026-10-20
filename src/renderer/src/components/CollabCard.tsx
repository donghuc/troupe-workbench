import { Badge } from './ui/Badge'
import { OS_WORDS } from '../../../shared/platform'
import { confirmDialog } from './ui/ConfirmDialog'
import { useState } from 'react'
import type { CollabRun, CollabTask, CollabTaskKind, CollabTaskStatus, ProviderId, ProviderInfo, CollabRecoverAction } from '../../../shared/types'
import { presetsFor, modelLists, disabledModelSet } from '../models'
import { rowsFromTasks, draftsFromRows, type PlanRow } from '../../../shared/collabPlan'
import { resolveTaskModel } from '../../../shared/models'
import { formatDuration } from '../../../shared/collabChecks'
import { isProviderId } from '../../../shared/providers'
import Icon from './Icon'
import { api } from '../api'
import { Button, IconButton } from './ui/Button'
import { Menu, MenuItem } from './ui/Menu'

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

// D-109/D-110/D-112: when a run pauses on a stuck task, ONE short panel: what's stuck, one
// line of why, ONE recommended fix as the main button, and a quiet row of the user's own
// options. Planner options that duplicate those (another agent, skip) aren't listed twice;
// any other Planner fix sits under "More fixes". Details (full diagnosis + findings) collapsed.
type Open = 'note' | 'agent' | 'more' | null
// Scope as shown in the plan list: paths relative to the deliverables folder, read-only inputs dropped.
const shortScope = (scope: string, outDir: string): string => {
  const s = scope.replace(/\(read[- ]only:[^)]*\)/gi, '').trim()
  const short = outDir ? s.split(outDir + '/').join('') : s
  return short.length > 70 ? short.slice(0, 68) + '…' : short
}
const stripDate = (h: string) => h.replace(/^\d{4}-\d{2}-\d{2} · /, '')

// The card shows plain text; runs from before D-121 stored the wrap-up's markdown as the summary.
const plain = (t: string): string => t.replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '')

function AttentionPanel({ run, task, providers }: { run: CollabRun; task: CollabTask; providers: ProviderInfo[] }): JSX.Element {
  const [open, setOpen] = useState<Open>(null)
  const [note, setNote] = useState('')
  const [to, setTo] = useState('')
  const [details, setDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const repair = run.repair && run.repair.taskId === task.id ? run.repair : null
  const current = (task.provider ?? run.providerId) as ProviderId
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  const others = providers.filter((p) => p.id !== current)
  const findings = task.lastVerdict?.findings ?? []
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  const recover = (action: CollabRecoverAction) => act(() => api.collab.recover(run.id, task.id, action))
  const best = repair ? repair.options[repair.recommended] : null
  // other Planner fixes, minus what the user's own options already cover
  const extras = repair ? repair.options.map((o, i) => ({ o, i })).filter(({ o, i }) => i !== repair.recommended && o.action !== 'skip' && o.action !== 'reassign') : []
  const pick = async (i: number) => {
    const o = repair!.options[i]
    if (o.userStep && !(await confirmDialog({ title: 'Done this first?', message: o.userStep, confirmLabel: 'Yes, continue' }))) return
    // D-121: a goal change is the user's call — show the new goal before applying it.
    if (o.changesGoal && !(await confirmDialog({ title: o.label, message: o.goal ? `This changes what the run delivers. The goal becomes:\n\n${o.goal}` : 'This changes what the run delivers. Continue?', confirmLabel: o.goal ? 'Change the goal' : 'Apply fix' }))) return
    await act(() => api.collab.applyRepair(run.id, i))
  }
  const skip = async () => {
    if (!(await confirmDialog({ title: `Skip “${task.title}”?`, message: 'Later tasks carry on without it, and the final review is told it was skipped.', confirmLabel: 'Skip task' }))) return
    await recover({ type: 'skip', note: note.trim() || undefined })
  }
  const toggle = (k: Open) => setOpen(open === k ? null : k)
  const why = repair?.summary ?? (findings[0] ? findingText(findings[0]) : 'It did not pass review.')
  return (
    <div className="collab-attn">
      <div className="collab-attn-title">“{task.title}” is stuck</div>
      <p className={`collab-attn-why${details ? '' : ' clamp'}`}>{why}</p>
      {(findings.length > 0 || why.length > 140) && (
        <Button variant="link" className="collab-attn-more" onClick={() => setDetails((v) => !v)}>{details ? 'Hide details' : 'Details'}</Button>
      )}
      {details && findings.length > 0 && <ol className="collab-findings">{findings.map((f, i) => <li key={i}>{findingText(f)}</li>)}</ol>}

      <div className="collab-attn-main">
        {best ? (
          <>
            <div className="collab-attn-best">
              <span className="collab-attn-best-label">{best.label}</span>
              {best.userStep && <span className="collab-choice-step">First you: {best.userStep}</span>}
            </div>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => pick(repair!.recommended)}>Apply fix</Button>
          </>
        ) : (
          <>
            <div className="collab-attn-best"><span className="collab-attn-best-label">Not sure what to do?</span><span className="collab-choice-step muted">The Planner reads the findings and suggests a fix.</span></div>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => recover({ type: 'repair', note: note.trim() || undefined })}>Ask the Planner</Button>
          </>
        )}
      </div>

      <div className="collab-attn-alt">
        <span className="collab-attn-or">Or</span>
        <Button variant="link" onClick={() => toggle('note')}>retry with instructions</Button>
        {task.kind === 'work' && others.length > 0 && <Button variant="link" onClick={() => toggle('agent')}>use another agent</Button>}
        <Button variant="link" onClick={skip} disabled={busy}>skip it</Button>
        {extras.length > 0 && <Button variant="link" onClick={() => toggle('more')}>{extras.length === 1 ? '1 more fix' : `${extras.length} more fixes`}</Button>}
      </div>

      {open === 'note' && (
        <div className="collab-attn-form">
          <textarea className="collab-ta" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell the agent what to do differently" />
          <div className="collab-choice-actions"><Button size="sm" disabled={busy} onClick={() => recover({ type: 'retry', note: note.trim() || undefined })}>{note.trim() ? 'Retry with note' : 'Retry as is'}</Button></div>
        </div>
      )}
      {open === 'agent' && (
        <div className="collab-attn-form">
          <div className="collab-choice-actions">
            <span className="collab-attn-now">Now: {nameOf(current)}</span>
            <select className="collab-kind-sel" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Agent">
              <option value="">Choose an agent</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button size="sm" disabled={busy || !to} onClick={() => recover({ type: 'reassign', provider: to as ProviderId })}>Reassign</Button>
          </div>
        </div>
      )}
      {open === 'more' && (
        <div className="collab-attn-form">
          {extras.map(({ o, i }) => (
            <div key={i} className="collab-attn-extra">
              <span className="collab-attn-best">{o.label}{o.userStep && <span className="collab-choice-step">First you: {o.userStep}</span>}</span>
              <Button size="sm" disabled={busy} onClick={() => pick(i)}>Apply</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  const addRow = (): string => { const key = `new-${Date.now()}`; setDraft([...rows, { key, title: '', kind: 'work', scope: '', acceptance: '', dependsOn: [] }]); return key }
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [menuRow, setMenuRow] = useState<string | null>(null)
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
  const retryRuns = run.spent?.retryRuns ?? 0
  const cap0 = run.budget?.maxRuns ?? 0
  const outOfBudget = run.status === 'needs_attention' && cap0 > 0 && spent >= cap0
  // the task the run is stuck on: the one the Planner's fix is for, else the first failed one
  const stuck = run.status === 'needs_attention' && !outOfBudget
    ? (tasks.find((t) => t.id === run.repair?.taskId) ?? tasks.find((t) => t.status === 'failed') ?? null)
    : null
  const cap = run.budget?.maxRuns ?? 0

  return (
    <div className={`collab-card status-${run.status}`}>
      <div className="collab-card-head">
        <Icon name="flash" size="sm" />
        <span className="collab-card-title">Collab · {RUN_LABEL[run.status] ?? run.status}</span>
        {(run.status === 'running' || run.status === 'planning') && <span className="activity-spinner spinner-xs" />}
        <span className="collab-card-spacer" />
        {cap > 0 && (run.status === 'running' || run.status === 'needs_attention') && (
          <span className="collab-budget" title={retryRuns ? `Agent runs used vs. budget · ${retryRuns} spent re-doing failed work` : 'Agent runs used vs. budget'}>{spent}/{cap} runs{retryRuns ? ` · ${retryRuns} on retries` : ''}</span>
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
            <Button variant="link" title={OS_WORDS.showInFolder} onClick={() => { void api.system.revealItem(run.projectCwd, run.outputDir) }}>
              Deliverables: {run.outputDir}/
            </Button>
          )}
        </div>
      )}

      {run.status === 'planning' && <div className="collab-note">Drafting a plan…</div>}

      {(run.status === 'failed' || run.status === 'stopped') && run.reason && (
        <div className="collab-reason">{run.reason}</div>
      )}
      {run.status === 'stopped' && run.summary && <div className="collab-summary">{plain(run.summary)}</div>}

      {/* D-121: the app's plan checks and the Planner's own conflicts, before the user approves. */}
      {editing && run.reason && (
        <div className="collab-reason warn collab-checks">
          <strong>Check before running</strong>
          <ul>{run.reason.split('\n').filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}

      {run.status === 'needs_attention' && !stuck && (
        <div className="collab-reason warn">{run.reason || 'Paused.'}</div>
      )}
      {run.status === 'needs_attention' && stuck && <AttentionPanel key={stuck.id} run={run} task={stuck} providers={providers} />}
      {run.status === 'running' && run.reason && <div className="collab-note">{run.reason}</div>}


      {tasks.length > 0 && !editing && (
        <ol className="collab-tasks">
          {tasks.map((t) => (
            <li key={t.id} className={`collab-task ${t.status}${t.id === stuck?.id ? ' stuck' : ''}`}>
              <span className="collab-task-status">{statusIcon(t.status)}</span>
              <span className="collab-task-body">
                <span className="collab-task-title">{t.title} {t.kind === 'review' && <span className="collab-kind">review</span>}{t.kind === 'review' && t.meta?.reviewer ? <Badge className="collab-agent-badge">by {providers.find((p) => p.id === t.meta.reviewer)?.name ?? t.meta.reviewer}</Badge> : t.kind !== 'review' && (t.provider || t.model) && (() => {
                  const pid = (t.provider ?? run.providerId) as ProviderId
                  const pname = providers.find((p) => p.id === pid)?.name ?? pid
                  const mv = resolveTaskModel(run.providerId, run.model, t.provider, t.model, modelLists(), disabledModelSet())
                  const mlabel = presetsFor(pid).find((m) => m.v === mv)?.l ?? 'Default'
                  return <Badge className="collab-agent-badge">{pname} · {mlabel}</Badge>
                })()}</span>
                {t.status === 'failed' && t.id !== stuck?.id && t.lastVerdict?.findings?.[0] ? <span className="collab-task-note">{findingText(t.lastVerdict.findings[0])}</span> : null}
                {t.status === 'skipped' && <span className="collab-task-note">Skipped{t.meta?.skipNote ? ` — ${t.meta.skipNote}` : ''}</span>}
                {t.status !== 'skipped' && t.meta?.history?.length ? <span className="collab-task-note">{stripDate(t.meta.history[t.meta.history.length - 1])}</span> : null}
                {t.meta?.startedAt && (t.meta.finishedAt || t.status === 'in_progress') ? <span className="collab-task-time">{formatDuration((t.meta.finishedAt ?? Date.now()) - t.meta.startedAt)}{t.meta.finishedAt ? '' : ' so far'}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {editing && (
        // D-113: the plan reads as a short numbered list (title, agent, what it produces, what
        // it waits for); one task at a time opens to edit. Moving and deleting live inside the
        // open task, not as icon rows on every task.
        <div className="collab-plan-edit">
          <div className="collab-plan-intro">{rows.length} task{rows.length === 1 ? '' : 's'} · check the plan, open a task to change it, then run.</div>
          <ol className="collab-plan-list">
            {rows.map((r, i) => {
              const isOpen = openRow === r.key
              const isReview = (r.kind ?? 'work') === 'review'
              const pid = (r.provider ?? run.providerId) as ProviderId
              const agent = isReview ? 'review' : `${providers.find((p) => p.id === pid)?.name ?? pid}${r.model ? ` · ${presetsFor(pid).find((m) => m.v === r.model)?.l ?? (r.model.charAt(0).toUpperCase() + r.model.slice(1))}` : ''}`
              const waits = (r.dependsOn ?? []).map((k) => rows.findIndex((x) => x.key === k)).filter((n) => n >= 0 && n !== i)
              const out = shortScope(r.scope ?? '', run.outputDir)
              // D-121: who reviews it, when it isn't the run's own agent
              const rev = r.reviewer && r.reviewer !== run.providerId ? (providers.find((p) => p.id === r.reviewer)?.name ?? r.reviewer) : ''
              return (
                <li key={r.key} className={`collab-plan-item${isOpen ? ' open' : ''}`}>
                  <div className="collab-plan-row">
                  <button className="collab-plan-hit" onClick={() => setOpenRow(isOpen ? null : r.key)} aria-expanded={isOpen}>
                    <span className="collab-plan-num">{i + 1}</span>
                    <span className="collab-plan-main">
                      <span className="collab-plan-title">{r.title?.trim() || 'Untitled task'}</span>
                      {(out || waits.length > 0) && (
                        <span className="collab-plan-sub">{out}{out && waits.length ? ' · ' : ''}{waits.length ? `after ${waits.map((n) => n + 1).join(', ')}` : ''}</span>
                      )}
                    </span>
                    <span className={`collab-plan-agent${isReview ? ' review' : ''}`}>{isReview && rev ? `review · ${rev}` : agent}{!isReview && rev ? ` · reviewed by ${rev}` : ''}</span>
                  </button>
                  <span className="collab-plan-more">
                    <IconButton title="More" aria-expanded={menuRow === r.key} onClick={() => setMenuRow(menuRow === r.key ? null : r.key)}><Icon name="more-vertical" size="md" /></IconButton>
                    <Menu open={menuRow === r.key} onClose={() => setMenuRow(null)}>
                      <MenuItem disabled={i === 0} onClick={() => { move(i, -1); setMenuRow(null) }}><Icon name="arrow-up" size="sm" />Move up</MenuItem>
                      <MenuItem disabled={i === rows.length - 1} onClick={() => { move(i, 1); setMenuRow(null) }}><Icon name="arrow-down" size="sm" />Move down</MenuItem>
                      <MenuItem danger onClick={() => { delRow(i); setMenuRow(null); if (isOpen) setOpenRow(null) }}><Icon name="trash" size="sm" />Delete task</MenuItem>
                    </Menu>
                  </span>
                  <IconButton className="collab-plan-expand" title={isOpen ? 'Collapse' : 'Edit task'} aria-expanded={isOpen} onClick={() => setOpenRow(isOpen ? null : r.key)}>
                    <Icon name="chevron-down" size="xs" className={`collab-plan-caret${isOpen ? ' open' : ''}`} />
                  </IconButton>
                  </div>
                  {isOpen && (
                    <div className="collab-plan-form">
                      <label className="collab-flabel">Task</label>
                      <input className="collab-ti" value={r.title ?? ''} placeholder="What should be done" onChange={(e) => setRow(i, { title: e.target.value })} />
                      <label className="collab-flabel">Produces <span className="collab-flabel-hint">files or folders this task owns</span></label>
                      <textarea className="collab-ta" rows={2} value={r.scope ?? ''} placeholder="e.g. notes/summary.md" onChange={(e) => setRow(i, { scope: e.target.value })} />
                      <label className="collab-flabel">Done when</label>
                      <textarea className="collab-ta" rows={3} value={r.acceptance ?? ''} placeholder="How anyone can tell it's done and correct" onChange={(e) => setRow(i, { acceptance: e.target.value })} />
                      <div className="collab-plan-fields">
                        <span className="collab-plan-field">
                          <label className="collab-flabel">Type</label>
                          <select className="collab-kind-sel" value={r.kind ?? 'work'} onChange={(e) => setRow(i, { kind: e.target.value as CollabTaskKind })}>
                            <option value="work">Work (agent does it, reviewer checks)</option>
                            <option value="review">Review only</option>
                          </select>
                        </span>
                        {!isReview && (
                          <span className="collab-plan-field">
                            <label className="collab-flabel">Agent</label>
                            <span className="collab-agent-row">
                              <select className="collab-kind-sel" value={r.provider ?? ''} onChange={(e) => setRow(i, { provider: (e.target.value || undefined) as ProviderId | undefined, model: undefined })}>
                                <option value="">Default</option>
                                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <select className="collab-kind-sel" value={r.model ?? ''} onChange={(e) => setRow(i, { model: e.target.value || undefined })}>
                                {presetsFor(pid).map((m) => <option key={m.v} value={m.v}>{m.v ? m.l : 'Default model'}</option>)}
                              </select>
                            </span>
                          </span>
                        )}
                        <span className="collab-plan-field">
                          <label className="collab-flabel">Reviewed by</label>
                          <select className="collab-kind-sel" value={r.reviewer ?? ''} onChange={(e) => setRow(i, { reviewer: (e.target.value || undefined) as ProviderId | undefined })}>
                            <option value="">Default</option>
                            {providers.filter((p) => isProviderId(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </span>
                      </div>
                      {waits.length > 0 && <div className="collab-plan-hint">Starts after {waits.length === 1 ? `task ${waits[0] + 1} passes` : `tasks ${waits.slice(0, -1).map((n) => n + 1).join(', ')} and ${waits[waits.length - 1] + 1} pass`} · <Button variant="link" onClick={() => setRow(i, { dependsOn: [] })}>don't wait</Button></div>}
                      {isReview && <div className="collab-plan-hint">Review tasks use the strong reviewer model.</div>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="collab-plan-actions">
            <Button size="sm" variant="ghost" onClick={() => { const k = addRow(); setOpenRow(k) }}><Icon name="plus" size="sm" />Add task</Button>
            <span className="collab-card-spacer" />
            <Button size="sm" onClick={stop} disabled={busy}>Reject</Button>
            <Button variant="primary" size="sm" onClick={confirm} disabled={busy || rows.length === 0}>
              {busy ? <><span className="activity-spinner spinner-xs" />Starting</> : 'Confirm & run'}
            </Button>
          </div>
        </div>
      )}

      {run.status === 'needs_attention' && (
        <div className="collab-plan-actions">
          <Button size="sm" variant="ghost" danger className="btn-icon-label" onClick={confirmStop} disabled={busy}><Icon name="stop" size="sm" />Stop run</Button>
          <span className="collab-card-spacer" />
          {outOfBudget
            ? <Button variant="primary" size="sm" onClick={() => resume(true)} disabled={busy}>Add 12 runs & continue</Button>
            : !stuck && <Button variant="primary" size="sm" onClick={() => resume(false)} disabled={busy}>Resume</Button>}
        </div>
      )}

      {run.status === 'done' && (() => {
        const anyFailed = tasks.some((t) => t.status === 'failed')
        return <div className={`collab-summary${anyFailed ? ' warn' : ''}`}>{anyFailed ? '⚠' : '✓'} {plain(run.summary) || 'Collab run complete.'}</div>
      })()}
    </div>
  )
}
