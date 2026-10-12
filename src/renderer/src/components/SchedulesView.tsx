import { useEffect, useState } from 'react'
import Icon from './Icon'
import MasterDetail from './MasterDetail'
import { api } from '../api'
import type { Project, ProviderInfo, Schedule, ScheduleKind, ScheduleTarget } from '../../../shared/types'
import type { PermissionMode } from '../../../shared/agent'

interface Props {
  projects: Project[]
  providers: ProviderInfo[]
  onRun: (s: Schedule) => void
}

const PERM: { v: PermissionMode; l: string }[] = [
  { v: 'read', l: 'Read-only' }, { v: 'auto', l: 'Auto' }, { v: 'full', l: 'Full access' }
]
const permLabel = (v: PermissionMode) => PERM.find((p) => p.v === v)?.l ?? v
const pad = (n: number) => String(n).padStart(2, '0')
const minToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const hhmmToMin = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const cadence = (s: Schedule) =>
  s.kind === 'daily' ? `Daily · ${minToHHMM(s.atMin)}`
    : s.intervalMin % 60 === 0 ? `Every ${s.intervalMin / 60}h` : `Every ${s.intervalMin}m`
const when = (t: number | null) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

type Sel = { mode: 'none' } | { mode: 'new' } | { mode: 'view'; id: string } | { mode: 'edit'; id: string }

export default function SchedulesView({ projects, providers, onRun }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [sel, setSel] = useState<Sel>({ mode: 'none' })
  const [menuOpen, setMenuOpen] = useState(false)
  // form
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [provider, setProvider] = useState(providers[0]?.id ?? 'claude-code')
  const [permMode, setPermMode] = useState<PermissionMode>('auto')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [everyN, setEveryN] = useState(1)
  const [everyUnit, setEveryUnit] = useState<'hours' | 'minutes'>('hours')
  const [atTime, setAtTime] = useState('09:00')
  const [target, setTarget] = useState<ScheduleTarget>('new')

  const load = () => api.schedules.list().then(setSchedules)
  useEffect(() => { load() }, [])

  const selId = sel.mode === 'view' || sel.mode === 'edit' ? sel.id : null
  const current = selId ? schedules.find((s) => s.id === selId) ?? null : null
  const editing = sel.mode === 'edit' ? current : null
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Project'
  const provName = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  const openView = (s: Schedule) => { setMenuOpen(false); setSel({ mode: 'view', id: s.id }) }
  const openNew = () => {
    setMenuOpen(false); setSel({ mode: 'new' })
    setTitle(''); setProjectId(projects[0]?.id ?? ''); setProvider(providers[0]?.id ?? 'claude-code')
    setPermMode('auto'); setPrompt(''); setKind('daily'); setEveryN(1); setEveryUnit('hours'); setAtTime('09:00'); setTarget('new')
  }
  const openEdit = (s: Schedule) => {
    setMenuOpen(false); setSel({ mode: 'edit', id: s.id })
    setTitle(s.title); setProjectId(s.projectId); setProvider(s.provider); setPermMode(s.permissionMode)
    setPrompt(s.prompt); setKind(s.kind); setTarget(s.target)
    setAtTime(minToHHMM(s.atMin))
    if (s.intervalMin % 60 === 0) { setEveryUnit('hours'); setEveryN(s.intervalMin / 60) }
    else { setEveryUnit('minutes'); setEveryN(s.intervalMin) }
  }
  const cancelEdit = () => setSel(current ? { mode: 'view', id: current.id } : { mode: 'none' })

  const fields = () => ({
    title: title.trim() || 'Scheduled task', prompt: prompt.trim(), provider, model: null,
    permissionMode: permMode, kind, target,
    intervalMin: kind === 'interval' ? (everyUnit === 'hours' ? everyN * 60 : everyN) : undefined,
    atMin: kind === 'daily' ? hhmmToMin(atTime) : undefined
  })
  const save = async () => {
    if (!projectId || !prompt.trim()) return
    if (editing) { await api.schedules.update(editing.id, fields()); await load(); setSel({ mode: 'view', id: editing.id }) }
    else { await api.schedules.create({ projectId, ...fields() }); await load(); setSel({ mode: 'none' }) }
  }
  const toggle = async (s: Schedule) => { await api.schedules.update(s.id, { enabled: !s.enabled }); load() }
  const remove = async (s: Schedule) => { if (confirm(`Delete “${s.title}”?`)) { await api.schedules.remove(s.id); await load(); setSel({ mode: 'none' }) } }

  const overflow = (s: Schedule) => (
    <span className="md-head-menu">
      <button className="icon-btn" title="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Icon name="more-vertical" size={16} /></button>
      {menuOpen && <>
        <div className="md-menu-backdrop" onClick={() => setMenuOpen(false)} />
        <div className="conv-menu"><button className="danger" onClick={() => { setMenuOpen(false); remove(s) }}>Delete</button></div>
      </>}
    </span>
  )

  const header = () => {
    if (sel.mode === 'new' || editing) return (
      <>
        <span className="md-head-title truncate">{editing ? title || editing.title : 'New task'}</span>
        <span className="md-head-spacer" />
        <button className="btn btn-sm" onClick={editing ? cancelEdit : () => setSel({ mode: 'none' })}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={!projectId || !prompt.trim()} onClick={save}>Save</button>
      </>
    )
    if (sel.mode === 'view' && current) return (
      <>
        <span className="md-head-title truncate">{current.title}</span>
        <div className="md-head-ops">
          <button className="btn btn-sm" onClick={() => onRun(current)}>Run now</button>
          <button className="btn btn-sm" onClick={() => toggle(current)}>{current.enabled ? 'Pause' : 'Enable'}</button>
        </div>
        <span className="md-head-spacer" />
        <button className="btn btn-sm" onClick={() => openEdit(current)}><Icon name="edit" size={14} />Edit</button>
        {overflow(current)}
      </>
    )
    return null
  }

  return (
    <MasterDetail
      listHeader={<button className="btn btn-sm" onClick={openNew} disabled={projects.length === 0}><Icon name="plus" size={14} />New task</button>}
      list={
        <>
          {schedules.length === 0 && <div className="sidebar-empty">No scheduled tasks yet.</div>}
          {schedules.map((s) => (
            <div key={s.id} className={`md-row ${selId === s.id ? 'active' : ''} ${s.enabled ? '' : 'md-row-off'}`} onClick={() => openView(s)}>
              <div className="md-row-main">
                <div className="truncate md-row-title">{s.title}</div>
                <div className="truncate md-row-sub">{projName(s.projectId)} · {cadence(s)} · {s.enabled ? `next ${when(s.nextRunAt)}` : 'paused'}</div>
              </div>
            </div>
          ))}
        </>
      }
      header={header()}
    >
      {sel.mode === 'none' && (
        <div className="md-placeholder">{projects.length === 0 ? 'Create a project first.' : 'Select a task, or create one.'}</div>
      )}

      {sel.mode === 'view' && current && (
        <div className="md-read">
          <div className="md-read-meta">
            {projName(current.projectId)} · {cadence(current)} · {current.enabled ? `next ${when(current.nextRunAt)}` : 'Paused'}
            {current.lastRunAt ? ` · last run ${when(current.lastRunAt)}` : ''}
          </div>
          <div className="md-read-label">Instructions</div>
          <div className={`md-read-body ${current.prompt ? '' : 'muted'}`}>{current.prompt || 'No instructions'}</div>
          <div className="md-read-label">Agent · Permission</div>
          <div className="md-read-text">{provName(current.provider)} · {permLabel(current.permissionMode)}</div>
          <div className="md-read-label">Each run</div>
          <div className="md-read-text">{current.target === 'same' ? 'Continues the same thread' : 'Starts a new thread'}</div>
        </div>
      )}

      {(sel.mode === 'new' || editing) && (
        <div className="schedule-editor">
          <label className="field-label">Task name</label>
          <input className="field-input" placeholder="Task name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="schedule-row">
            <div className="schedule-field">
              <label className="field-label">Project</label>
              <select className="field-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="schedule-field">
              <label className="field-label">Agent</label>
              <select className="field-input" value={provider} onChange={(e) => setProvider(e.target.value as Schedule['provider'])}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="schedule-field">
              <label className="field-label">Permission</label>
              <select className="field-input" value={permMode} onChange={(e) => setPermMode(e.target.value as PermissionMode)}>
                {PERM.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </div>
          </div>
          <label className="field-label">Instructions</label>
          <textarea className="schedule-prompt" placeholder="What should the agent do each run?" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <label className="field-label">When</label>
          <div className="schedule-row schedule-when">
            <div className="seg-control">
              <button className={`seg-btn ${kind === 'daily' ? 'active' : ''}`} onClick={() => setKind('daily')}>Daily</button>
              <button className={`seg-btn ${kind === 'interval' ? 'active' : ''}`} onClick={() => setKind('interval')}>Every</button>
            </div>
            {kind === 'daily' ? (
              <input className="field-input schedule-time" type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
            ) : (
              <>
                <input className="field-input schedule-n" type="number" min={1} value={everyN} onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))} />
                <select className="field-input schedule-unit" value={everyUnit} onChange={(e) => setEveryUnit(e.target.value as 'hours' | 'minutes')}>
                  <option value="hours">hours</option>
                  <option value="minutes">minutes</option>
                </select>
              </>
            )}
          </div>
          <label className="field-label">Each run</label>
          <div className="seg-control seg-inline">
            <button className={`seg-btn ${target === 'new' ? 'active' : ''}`} onClick={() => setTarget('new')}>New thread</button>
            <button className={`seg-btn ${target === 'same' ? 'active' : ''}`} onClick={() => setTarget('same')}>Same thread</button>
          </div>
        </div>
      )}
    </MasterDetail>
  )
}
