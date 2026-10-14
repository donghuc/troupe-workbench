import { Badge } from './ui/Badge'
import { confirmDialog } from './ui/ConfirmDialog'
import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import MasterDetail from './MasterDetail'
import { api } from '../api'
import type { Skill, SkillScope, Project } from '../../../shared/types'
import { Menu, MenuItem } from './ui/Menu'
import { Button, IconButton } from './ui/Button'

type Sel =
  | { mode: 'none' }
  | { mode: 'view'; id: string }
  | { mode: 'edit'; id: string }
  | { mode: 'new' }
  | { mode: 'draft' }

export default function SkillsView({ projects }: { projects: Project[] }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [projectOf, setProjectOf] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<Sel>({ mode: 'none' })
  const [menuOpen, setMenuOpen] = useState(false)
  // editor fields
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [triggers, setTriggers] = useState('')
  const [scope, setScope] = useState<'global' | string>('global')
  // draft-with-agent
  const [purpose, setPurpose] = useState('')
  const [draftScope, setDraftScope] = useState<'global' | string>('global')
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  const withFolder = useMemo(() => projects.filter((p) => p.folderPath), [projects])
  const folderFor = (projectId: string) => withFolder.find((p) => p.id === projectId)?.folderPath ?? undefined
  const projectName = (folderPath: string) => withFolder.find((p) => p.folderPath === folderPath)?.name ?? 'Project'

  const refresh = async () => {
    const globals = await api.skills.list()
    const perProject = await Promise.all(withFolder.map(async (p) => ({ folder: p.folderPath!, list: await api.skills.list(p.folderPath!) })))
    const map: Record<string, string> = {}
    const all = [...globals]
    for (const { folder, list } of perProject) for (const s of list) { map[s.id] = folder; all.push(s) }
    setProjectOf(map); setSkills(all)
  }
  useEffect(() => { refresh(); return api.skills.onChanged(refresh) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const cwdOf = (s: Skill) => (s.scope === 'project' ? projectOf[s.id] : undefined)
  const scopeLabel = (s: Skill) => (s.scope === 'project' ? projectName(projectOf[s.id] ?? '') : 'Global')

  const selId = sel.mode === 'view' || sel.mode === 'edit' ? sel.id : null
  const current = selId ? skills.find((s) => s.id === selId) ?? null : null
  const editing = sel.mode === 'edit' ? current : null

  const openView = (s: Skill) => { setMenuOpen(false); setSel({ mode: 'view', id: s.id }) }
  const openEdit = (s: Skill) => {
    setMenuOpen(false)
    setSel({ mode: 'edit', id: s.id })
    setName(s.name); setDescription(s.description); setBody(s.body); setTriggers(s.triggers)
    setScope(s.scope === 'project' ? (withFolder.find((p) => p.folderPath === projectOf[s.id])?.id ?? 'global') : 'global')
  }
  const openNew = () => { setMenuOpen(false); setSel({ mode: 'new' }); setName(''); setDescription(''); setBody(''); setTriggers(''); setScope('global') }
  const openDraft = () => { setMenuOpen(false); setSel({ mode: 'draft' }); setPurpose(''); setDraftError(null) }
  const cancelEdit = () => setSel(current ? { mode: 'view', id: current.id } : { mode: 'none' })

  const save = async () => {
    if (!name.trim()) return
    if (editing) {
      await api.skills.update(editing.id, { name, description, body, triggers }, cwdOf(editing))
      await refresh(); setSel({ mode: 'view', id: editing.id })
    } else {
      const isProject = scope !== 'global'
      await api.skills.create({ name, description, body, triggers, scope: (isProject ? 'project' : 'global') as SkillScope }, isProject ? folderFor(scope) : undefined)
      await refresh(); setSel({ mode: 'none' })
    }
  }
  const remove = async (s: Skill) => { if (await confirmDialog({ title: 'Delete skill?', message: `“${s.name}” is deleted.`, confirmLabel: 'Delete' })) { await api.skills.remove(s.id, cwdOf(s)); await refresh(); setSel({ mode: 'none' }) } }
  const resetBuiltin = async (s: Skill) => { if (await confirmDialog({ title: `Reset “${s.name}”?`, message: 'It goes back to its built-in default. Any edits you made will be lost.', confirmLabel: 'Reset' })) { await api.skills.reset(s.id); await refresh(); setSel({ mode: 'view', id: s.id }) } }
  const doDraft = async () => {
    setDraftBusy(true); setDraftError(null)
    try {
      const isProject = draftScope !== 'global'
      await api.skills.draft(purpose.trim(), (isProject ? 'project' : 'global') as SkillScope, isProject ? folderFor(draftScope) : undefined)
      await refresh(); setSel({ mode: 'none' })
    } catch (e) { setDraftError(String((e as Error)?.message || e)) } finally { setDraftBusy(false) }
  }

  const overflow = (s: Skill) => (
    <span className="md-head-menu">
      <IconButton title="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Icon name="more-vertical" size="md" /></IconButton>
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)}>{s.builtin
        ? <MenuItem onClick={() => { setMenuOpen(false); resetBuiltin(s) }}>Reset to default</MenuItem>
        : <MenuItem danger onClick={() => { setMenuOpen(false); remove(s) }}>Delete</MenuItem>}
      </Menu>
    </span>
  )

  const header = () => {
    if (sel.mode === 'draft') return <><span className="md-head-title">Draft with agent</span><span className="md-head-spacer" /><Button size="sm" onClick={() => setSel({ mode: 'none' })} disabled={draftBusy}>Cancel</Button><Button variant="primary" size="sm" disabled={!purpose.trim() || draftBusy} onClick={doDraft}>{draftBusy ? <><span className="activity-spinner spinner-xs" />Drafting</> : 'Draft'}</Button></>
    if (sel.mode === 'new' || editing) return (
      <>
        <span className="md-head-title truncate">{editing ? name || editing.name : 'New skill'}</span>
        <span className="md-head-spacer" />
        <Button size="sm" onClick={editing ? cancelEdit : () => setSel({ mode: 'none' })}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!name.trim()} onClick={save}>Save</Button>
      </>
    )
    if (sel.mode === 'view' && current) return (
      <>
        <span className="md-head-title truncate">{current.name}</span>
        {current.builtin && <Badge tone="accent" className="skill-builtin-badge">Built-in</Badge>}
        <Badge className="skill-scope-badge">{scopeLabel(current)}</Badge>
        <span className="md-head-spacer" />
        <Button size="sm" onClick={() => openEdit(current)}><Icon name="edit" size="sm" />Edit</Button>
        {overflow(current)}
      </>
    )
    return null
  }

  return (
    <MasterDetail
      listHeader={
        <>
          <Button size="sm" onClick={openNew}><Icon name="plus" size="sm" />New skill</Button>
          <Button size="sm" onClick={openDraft}><Icon name="flash" size="sm" />Draft</Button>
        </>
      }
      list={
        <>
          {skills.length === 0 && <div className="sidebar-empty">No skills yet.</div>}
          {skills.map((s) => (
            <div key={s.id} className={`md-row ${selId === s.id ? 'active' : ''}`} onClick={() => openView(s)}>
              <div className="md-row-main">
                <div className="truncate md-row-title">{s.name} {s.builtin && <Badge tone="accent" className="skill-builtin-badge">Built-in</Badge>}<Badge className="skill-scope-badge">{scopeLabel(s)}</Badge></div>
                <div className="truncate md-row-sub">{s.description || s.body.slice(0, 100)}</div>
              </div>
            </div>
          ))}
        </>
      }
      header={header()}
    >
      {sel.mode === 'none' && <div className="md-placeholder">Select a skill, or create one.</div>}

      {sel.mode === 'view' && current && (
        <div className="md-read">
          <div className="md-read-label">Description</div>
          <div className={`md-read-text ${current.description ? '' : 'muted'}`}>{current.description || 'No description'}</div>
          <div className="md-read-label">Instructions</div>
          <div className={`md-read-body ${current.body ? '' : 'muted'}`}>{current.body || 'No instructions'}</div>
          <div className="md-read-label">Auto-apply triggers</div>
          <div className={`md-read-text ${current.triggers ? '' : 'muted'}`}>{current.triggers || 'None'}</div>
          <div className="md-read-label">Scope</div>
          <div className="md-read-text">{scopeLabel(current)}{current.builtin ? ' · Built-in (editable; reset to default from the ⋯ menu)' : ''}</div>
        </div>
      )}

      {sel.mode === 'draft' && (
        <div className="skill-editor">
          <label className="field-label">Purpose</label>
          <textarea className="field-textarea" autoFocus value={purpose} placeholder={'e.g. Review a React component for accessibility issues and list them by severity with fixes.'} onChange={(e) => setPurpose(e.target.value)} />
          <label className="field-label">Scope</label>
          <select className="field-input" value={draftScope} onChange={(e) => setDraftScope(e.target.value)}>
            <option value="global">Global — all projects</option>
            {withFolder.map((p) => <option key={p.id} value={p.id}>Project: {p.name}</option>)}
          </select>
          {draftError && <div className="mcp-error">⚠ {draftError}</div>}
        </div>
      )}

      {(sel.mode === 'new' || editing) && (
        <div className="skill-editor">
          <label className="field-label">Name</label>
          <input className="field-input" autoFocus value={name} placeholder="e.g. UX review" onChange={(e) => setName(e.target.value)} />
          <label className="field-label">Description</label>
          <input className="field-input" value={description} placeholder="When to use it" onChange={(e) => setDescription(e.target.value)} />
          <label className="field-label">Instructions</label>
          <textarea className="field-textarea skill-body" value={body} placeholder="What should the AI do when this skill is applied?" onChange={(e) => setBody(e.target.value)} />
          <label className="field-label">Auto-apply triggers</label>
          <input className="field-input" value={triggers} placeholder="e.g. review, critique, heuristics" onChange={(e) => setTriggers(e.target.value)} />
          {!editing && (
            <>
              <label className="field-label">Scope</label>
              <select className="field-input" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="global">Global — all projects</option>
                {withFolder.map((p) => <option key={p.id} value={p.id}>Project: {p.name}</option>)}
              </select>
            </>
          )}
        </div>
      )}
    </MasterDetail>
  )
}
