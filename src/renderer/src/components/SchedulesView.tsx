import { confirmDialog } from './ui/ConfirmDialog'
import { useEffect, useState } from 'react'
import Icon from './Icon'
import MasterDetail from './MasterDetail'
import { api } from '../api'
import type { Project, ProviderInfo, Schedule, ScheduleKind, ScheduleTarget } from '../../../shared/types'
import type { PermissionMode } from '../../../shared/agent'
import { Menu, MenuItem } from './ui/Menu'
import { Button, IconButton } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { Badge } from './ui/Badge'
import Switch from './settings/Switch'
import { describeChange } from '../../../shared/scheduleRules'
import { failed } from '../notices'

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
  useEffect(() => { load(); return api.schedules.onChanged(() => { void load() }) }, [])   // D-134: bots change tasks too

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
    title: title.trim() || 'Scheduled task', prompt: prompt.trim(), provider, model: editing && editing.provider === provider ? editing.model : null,
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
  // D-134: a bot's change waiting for you, and handing a task over to bots.
  const review = async (s: Schedule, approve: boolean) => {
    if (!approve && s.pending?.kind === 'new' && !(await confirmDialog({ title: 'Discard this task?', message: `“${s.title}” was made by a bot and never ran. Discarding deletes it.`, confirmLabel: 'Discard' }))) return
    if (approve && s.pending?.kind === 'delete' && !(await confirmDialog({ title: 'Delete task?', message: `A bot asked to delete “${s.title}”. It stops running and is removed.`, confirmLabel: 'Delete' }))) return
    const r = await api.schedules.review(s.id, approve).catch(failed('Review task'))
    await load()
    if (r === null) setSel({ mode: 'none' })
  }
  const setManaged = async (s: Schedule, on: boolean) => { await api.schedules.setBotManaged(s.id, on).catch(failed('Bots can manage this task')); load() }
  const remove = async (s: Schedule) => { if (await confirmDialog({ title: 'Delete task?', message: `“${s.title}” stops running and is removed.`, confirmLabel: 'Delete' })) { await api.schedules.remove(s.id); await load(); setSel({ mode: 'none' }) } }

  const overflow = (s: Schedule) => (
    <span className="md-head-menu">
      <IconButton title="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Icon name="more-vertical" size="md" /></IconButton>
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)}>
        <MenuItem danger onClick={() => { setMenuOpen(false); remove(s) }}><Icon name="trash" size="sm" />Delete</MenuItem>
      </Menu>
    </span>
  )

  const header = () => {
    if (sel.mode === 'new' || editing) return (
      <>
        <span className="md-head-title truncate">{editing ? title || editing.title : 'New task'}</span>
        <span className="md-head-spacer" />
        <Button size="sm" onClick={editing ? cancelEdit : () => setSel({ mode: 'none' })}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!projectId || !prompt.trim()} onClick={save}>Save</Button>
      </>
    )
    if (sel.mode === 'view' && current) return (
      <>
        <span className="md-head-title truncate">{current.title}</span>
        <div className="md-head-ops">
          <Button size="sm" disabled={!!current.pending} onClick={() => onRun(current)}>Run now</Button>
          <Button size="sm" disabled={!!current.pending} onClick={() => toggle(current)}>{current.enabled ? 'Pause' : 'Enable'}</Button>
        </div>
        <span className="md-head-spacer" />
        <Button size="sm" disabled={!!current.pending} onClick={() => openEdit(current)}><Icon name="edit" size="sm" />Edit</Button>
        {overflow(current)}
      </>
    )
    return null
  }

  return (
    <MasterDetail
      listHeader={<Button size="sm" onClick={openNew} disabled={projects.length === 0}><Icon name="plus" size="sm" />New task</Button>}
      list={
        <>
          {schedules.length === 0 && <div className="sidebar-empty">No scheduled tasks yet.</div>}
          {schedules.map((s) => (
            <div key={s.id} className={`md-row ${selId === s.id ? 'active' : ''} ${s.enabled ? '' : 'md-row-off'}`} onClick={() => openView(s)}>
              <div className="md-row-main">
                <div className="sched-row-title"><span className="truncate md-row-title">{s.title}</span>{s.pending && <Badge tone="warning" appearance="soft">Waiting for you</Badge>}</div>
                <div className="truncate md-row-sub">{projName(s.projectId)} · {cadence(s)} · {s.pending ? 'waiting for approval' : s.enabled ? `next ${when(s.nextRunAt)}` : 'paused'}{s.botManaged ? ' · bots can manage' : ''}</div>
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
          {current.pending && (
            <div className="sched-review" role="region" aria-label="Waiting for your approval">
              <div className="sched-review-title">{current.pending.kind === 'new' ? 'A bot made this task from the command line' : current.pending.kind === 'delete' ? 'A bot asked to delete this task' : 'A bot changed this task'}</div>
              <div className="sched-review-text">
                {current.pending.kind === 'new' ? 'It won’t run until you approve it. Check the instructions, agent and permission below.'
                  : current.pending.kind === 'delete' ? 'It runs in Full access, so deleting it needs your OK. It’s paused until you decide.'
                  : 'It runs in Full access, so the change needs your OK. It’s paused until you decide.'}
              </div>
              {current.pending.kind === 'edit' && <ul className="sched-review-changes">{describeChange(current.pending).map((l) => <li key={l}>{l}</li>)}</ul>}
              <div className="sched-review-actions">
                <Button variant="primary" size="sm" onClick={() => review(current, true)}>{current.pending.kind === 'delete' ? 'Delete task' : current.pending.kind === 'new' ? 'Approve and turn on' : 'Approve change'}</Button>
                <Button size="sm" onClick={() => review(current, false)}>{current.pending.kind === 'new' ? 'Discard task' : current.pending.kind === 'delete' ? 'Keep task' : 'Discard change'}</Button>
              </div>
            </div>
          )}
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
          <div className="md-read-label">Command line</div>
          <div className="sched-bots">
            <div className="sched-bots-text">
              <div className="md-read-text">Bots can manage this task{current.createdVia === 'cli' ? ' · made from the command line' : ''}</div>
              <div className="field-hint">Bots using the <code>troupe</code> command can always list, run, pause and resume tasks. With this on they can also edit and delete this one — never raising its permission, and a Full-access task’s edits and deletion still wait for you.</div>
            </div>
            <Switch on={current.botManaged} label={`Bots can manage this task ${current.botManaged ? 'on' : 'off'}`} onChange={(v) => setManaged(current, v)} />
          </div>
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
            <Segmented label="Repeat" value={kind} onChange={setKind}
              options={[{ value: 'daily', label: 'Daily' }, { value: 'interval', label: 'Every' }]} />
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
          <Segmented label="Each run" className="seg-inline" value={target} onChange={setTarget}
            options={[{ value: 'new', label: 'New thread' }, { value: 'same', label: 'Same thread' }]} />
        </div>
      )}
    </MasterDetail>
  )
}
