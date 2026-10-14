import { useEffect, useState } from 'react'
import { api } from '../api'
import Icon from './Icon'
import MasterDetail from './MasterDetail'
import type { Project, MemoryOverview, MirrorResult } from '../../../shared/types'
import { Button } from './ui/Button'

interface Props {
  projects: Project[]
  onChanged?: () => void
}

type Target = { kind: 'global' } | { kind: 'project'; id: string }

const sameTarget = (a: Target | null, b: Target): boolean =>
  !!a && a.kind === b.kind && (a.kind === 'global' || a.id === (b as { id: string }).id)

export default function MemoryView({ projects, onChanged }: Props) {
  const [overview, setOverview] = useState<MemoryOverview | null>(null)
  const [target, setTarget] = useState<Target | null>({ kind: 'global' })
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  // Result of the last save's AGENTS.md mirror — surfaced when it was skipped (D-055).
  const [mirror, setMirror] = useState<MirrorResult | null>(null)
  const [adopting, setAdopting] = useState(false)

  const loadOverview = () => api.projectMemory.overview().then(setOverview)
  useEffect(() => { loadOverview() }, [])

  // Load the selected target's memory text.
  useEffect(() => {
    if (!target) return
    let cancelled = false
    setLoaded(false)
    setMirror(null)
    const done = (v: string) => { if (!cancelled) { setText(v); setOriginal(v); setLoaded(true) } }
    if (target.kind === 'global') {
      api.projectMemory.globalRead().then((v: string | null) => done(v ?? '')).catch(() => done(''))
    } else {
      const p = projects.find((x) => x.id === target.id)
      if (p?.folderPath) api.projectMemory.read(p.folderPath).then((v: string | null) => done(v ?? '')).catch(() => done(''))
      else done(p?.memory ?? '')
    }
    return () => { cancelled = true }
    /* eslint-disable-next-line */
  }, [target])

  const dirty = loaded && text !== original

  // The folder of the current target, or null for global. Folderless projects
  // (DB memory) have no mirror at all, so they report `undefined`.
  const targetFolder = (): string | null | undefined => {
    if (!target) return undefined
    if (target.kind === 'global') return null
    return projects.find((x) => x.id === target.id)?.folderPath ?? undefined
  }

  const save = async () => {
    if (!target || !dirty) return
    setSaving(true)
    try {
      let result: MirrorResult | null = null
      if (target.kind === 'global') result = await api.projectMemory.globalWrite(text)
      else {
        const p = projects.find((x) => x.id === target.id)
        if (p?.folderPath) result = await api.projectMemory.write(p.folderPath, text)
        else if (p) await api.projects.update(p.id, { memory: text })
      }
      setMirror(result && !result.mirrored ? result : null)
      setOriginal(text)
      await loadOverview()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  // One-time, explicit: fold the hand-written AGENTS.md into CLAUDE.md, then mirror.
  const adopt = async () => {
    const folder = targetFolder()
    if (folder === undefined) return
    setAdopting(true)
    try {
      const merged = await api.projectMemory.adopt(folder)
      setText(merged)
      setOriginal(merged)
      setMirror(null)
      await loadOverview()
      onChanged?.()
    } finally {
      setAdopting(false)
    }
  }

  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Project'
  const meta = (chars: number) => (chars > 0 ? `${chars.toLocaleString()} chars` : 'Not set')
  const heading = !target ? '' : target.kind === 'global' ? 'Global memory' : projName(target.id)

  return (
    <MasterDetail
      contentWhite
      contentClassName="memory-content"
      listHeader={<span className="section-label md-list-title">Memory</span>}
      list={
        <>
          <div
            className={`md-row ${sameTarget(target, { kind: 'global' }) ? 'active' : ''}`}
            onClick={() => setTarget({ kind: 'global' })}
          >
            <Icon name="grid" size="md" className="mem-ico" />
            <div className="md-row-main">
              <div className="truncate md-row-title">Global</div>
              <div className="truncate md-row-sub">{overview ? meta(overview.global.chars) : '…'} · all projects</div>
            </div>
          </div>

          <div className="section-label">Projects</div>
          {overview?.projects.length === 0 && <div className="sidebar-empty">No projects</div>}
          {overview?.projects.map((p) => (
            <div
              key={p.id}
              className={`md-row ${sameTarget(target, { kind: 'project', id: p.id }) ? 'active' : ''}`}
              onClick={() => setTarget({ kind: 'project', id: p.id })}
            >
              <Icon name="folder-open" size="md" className="mem-ico" />
              <div className="md-row-main">
                <div className="truncate md-row-title">{p.name}</div>
                <div className="truncate md-row-sub">{meta(p.chars)}{p.folderPath ? '' : ' · no folder'}</div>
              </div>
            </div>
          ))}
        </>
      }
      header={target && (
        <>
          <span className="md-head-title truncate">{heading}</span>
          <span className="md-head-meta">
            {text.length.toLocaleString()} chars{text.length > 30000 ? ' · near Codex 32 KB cap' : ''}
          </span>
          <span className="md-head-spacer" />
          <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <><span className="activity-spinner spinner-xs" />Saving</> : 'Save'}
          </Button>
        </>
      )}
    >
      {!target ? (
        <div className="md-placeholder">Select memory to edit.</div>
      ) : (
        <>
        {mirror && (
          <div className="mem-mirror-note">
            <span>
              {mirror.reason === 'unreadable'
                ? "Workbench could not read the AGENTS.md here, so it will inject this memory for Codex instead of mirroring it."
                : "Codex has its own AGENTS.md here, so Workbench will inject this memory for Codex instead of mirroring it."}
            </span>
            <Button size="sm" onClick={adopt} disabled={adopting}>
              {adopting ? 'Adopting…' : 'Adopt AGENTS.md'}
            </Button>
          </div>
        )}
        <textarea
          className="memory-editor-body"
          value={text}
          disabled={!loaded}
          placeholder={target.kind === 'global'
            ? '# Global memory\n\nApplies to every project — how you like Claude to work, standing preferences…'
            : '# Project memory\n\nDecisions, current state, constraints, open questions…'}
          onChange={(e) => setText(e.target.value)}
        />
        </>
      )}
    </MasterDetail>
  )
}
