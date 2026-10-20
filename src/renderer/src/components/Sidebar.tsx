import { confirmDialog } from './ui/ConfirmDialog'
import { OS_WORDS } from '../../../shared/platform'
import { useMemo, useState, type DragEvent, useEffect } from 'react'
import Icon from './Icon'
import logo from '../assets/logo.png'
import ResizeHandle from './ResizeHandle'
import { useBusyConversations, useUnreadConversations } from '../turnsStore'
import type { Project, RecentConversation } from '../../../shared/types'
import { Menu, MenuItem } from './ui/Menu'

const COLLAPSED_KEY = 'sidebar.collapsedProjects'

interface Props {
  projects: Project[]
  conversations: RecentConversation[]   // ALL conversations, cross-project, updated-desc
  activeProjectId: string | null
  activeConversationId: string | null
  onSelectProject: (id: string | null) => void
  onOpenConversation: (projectId: string, convId: string) => void
  onNewProject: () => void
  onRenameConversation: (id: string, title: string) => void
  onDeleteConversation: (id: string) => void
  onExportConversation: (id: string) => void
  onDuplicateConversation: (id: string) => void
  onOpenSearch: () => void
  onSetPinned: (id: string, pinned: boolean) => void
  onRenameProject: (id: string, name: string) => void
  onDeleteProject: (id: string) => void
  onReorderProjects: (orderedIds: string[]) => void
  onOpenNotes: () => void
  notesActive: boolean
  onOpenMemory: () => void
  memoryActive: boolean
  onOpenTasks: () => void
  tasksActive: boolean
  skillsActive: boolean
  onOpenSkills: () => void
  onOpenImage: () => void
  imageActive: boolean
  onOpenSettings: () => void
}

const PROJECTS_SHOWN = 10

export default function Sidebar(props: Props) {
  const {
    projects, conversations, activeProjectId, activeConversationId,
    onSelectProject, onOpenConversation, onNewProject,
    onRenameConversation, onDeleteConversation, onExportConversation, onDuplicateConversation, onOpenSearch, onSetPinned, onRenameProject, onDeleteProject, onReorderProjects, onOpenNotes, notesActive, onOpenMemory, memoryActive, onOpenTasks, tasksActive, onOpenSkills, skillsActive, onOpenImage, imageActive, onOpenSettings
  } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [showAllProjects, setShowAllProjects] = useState(false)
  const busy = useBusyConversations()
  const unread = useUnreadConversations()
  // Projects are expanded by default; collapsing adds the id here. Remembered across
  // restarts in localStorage (like composer drafts) — it is per-window UI state, not data.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []) } catch { return new Set() }
  })
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])) } catch { /* storage unavailable */ } }, [collapsed])

  const startRename = (c: RecentConversation) => { setMenuId(null); setRenaming(c.id); setDraft(c.title) }
  const commitRename = (id: string) => { const t = draft.trim(); if (t) onRenameConversation(id, t); setRenaming(null) }
  const [pMenuId, setPMenuId] = useState<string | null>(null)
  const [pRenaming, setPRenaming] = useState<string | null>(null)
  const [pDraft, setPDraft] = useState('')
  const startPRename = (p: Project) => { setPMenuId(null); setPRenaming(p.id); setPDraft(p.name) }
  const commitPRename = (id: string) => { const t = pDraft.trim(); if (t) onRenameProject(id, t); setPRenaming(null) }

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Chats grouped by project (input is updated-desc; pinned float to the top within a group).
  const byProject = useMemo(() => {
    const m = new Map<string, RecentConversation[]>()
    for (const c of conversations) {
      const arr = m.get(c.projectId) ?? []
      arr.push(c)
      m.set(c.projectId, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => Number(b.pinned) - Number(a.pinned))
    return m
  }, [conversations])

  // Stable order: sort by creation time so switching chats never reshuffles the sidebar.
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  // Projects arrive already in manual (sort_order) order from the repo.
  const orderedProjects = projects
  const onProjDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault(); setOverId(null)
    const id = dragId; setDragId(null)
    if (!id || id === targetId) return
    const ids = orderedProjects.map((x) => x.id)
    const from = ids.indexOf(id); if (from < 0) return
    ids.splice(from, 1)
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    let to = ids.indexOf(targetId); if (to < 0) return
    if (after) to += 1
    ids.splice(to, 0, id)
    onReorderProjects(ids)
  }
  const projShown = showAllProjects ? orderedProjects : orderedProjects.slice(0, PROJECTS_SHOWN)

  // One nested chat row inside a project group.
  const convRow = (c: RecentConversation) => (
    <div key={c.id} className={`chat-row ${activeConversationId === c.id ? 'active' : ''}`}>
      {renaming === c.id ? (
        <input
          className="inline-edit" autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitRename(c.id)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c.id); if (e.key === 'Escape') setRenaming(null) }}
        />
      ) : (
        <>
          <span className={`chat-bullet ${busy.includes(c.id) ? 'busy' : unread.includes(c.id) ? 'unread' : ''}`} title={busy.includes(c.id) ? 'Agent running' : unread.includes(c.id) ? 'New reply' : undefined} />
          <span className="truncate chat-title" onClick={() => onOpenConversation(c.projectId, c.id)} title={c.title}>
            {c.pinned && <Icon name="pin" size="xs" className="pin-dot" />}
            {c.title}
          </span>
          <button className="conv-menu-btn" title="More" onClick={() => setMenuId(menuId === c.id ? null : c.id)}><Icon name="more-vertical" size="md" /></button>
          <Menu open={menuId === c.id} onClose={() => setMenuId(null)}>
            <MenuItem onClick={() => startRename(c)}>Rename</MenuItem>
            <MenuItem onClick={() => { setMenuId(null); onSetPinned(c.id, !c.pinned) }}>{c.pinned ? 'Unpin' : 'Pin'}</MenuItem>
            <MenuItem onClick={() => { setMenuId(null); onDuplicateConversation(c.id) }}>Duplicate</MenuItem>
            <MenuItem onClick={() => { setMenuId(null); onExportConversation(c.id) }}>Export…</MenuItem>
            <MenuItem danger onClick={() => { setMenuId(null); void confirmDialog({ title: 'Delete chat?', message: `“${c.title}” and its messages are deleted.`, confirmLabel: 'Delete' }).then((ok) => ok && onDeleteConversation(c.id)) }}><Icon name="trash" size="sm" />Delete</MenuItem>
          </Menu>
        </>
      )}
    </div>
  )

  // A project group: header (folder + name + caret) with its chats nested below.
  const projGroup = (p: Project) => {
    const chats = byProject.get(p.id) ?? []
    const isOpen = !collapsed.has(p.id)
    const headerActive = activeProjectId === p.id && !activeConversationId
    return (
      <div
        key={p.id}
        className={`proj-group${dragId === p.id ? ' dragging' : ''}${overId === p.id && dragId && dragId !== p.id ? ' drag-over' : ''}`}
        onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overId !== p.id) setOverId(p.id) } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverId((o) => (o === p.id ? null : o)) }}
        onDrop={(e) => onProjDrop(e, p.id)}
      >
        <div
          className={`proj-header ${headerActive ? 'active' : ''}`}
          draggable={pRenaming !== p.id}
          onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setDragId(null); setOverId(null) }}
        >
          {pRenaming === p.id ? (
            <input
              className="inline-edit" autoFocus value={pDraft}
              onChange={(e) => setPDraft(e.target.value)}
              onBlur={() => commitPRename(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPRename(p.id); if (e.key === 'Escape') setPRenaming(null) }}
            />
          ) : (
            <>
              <span className="proj-main" onClick={() => (headerActive ? toggle(p.id) : onSelectProject(p.id))} title={p.name}>
                <Icon name="folder-open" size="md" className="proj-folder" />
                <span className="truncate proj-name">{p.name}</span>
              </span>
              <button className="conv-menu-btn" title="More" onClick={() => setPMenuId(pMenuId === p.id ? null : p.id)}><Icon name="more-vertical" size="md" /></button>
              <Menu open={pMenuId === p.id} onClose={() => setPMenuId(null)}>
                <MenuItem onClick={() => startPRename(p)}>Rename</MenuItem>
                <MenuItem danger onClick={() => { setPMenuId(null); void confirmDialog({ title: `Delete “${p.name}”?`, message: "The project and all its chats are deleted. This can't be undone.", confirmLabel: 'Delete' }).then((ok) => ok && onDeleteProject(p.id)) }}><Icon name="trash" size="sm" />Delete</MenuItem>
              </Menu>
            </>
          )}
        </div>
        {isOpen && chats.length > 0 && <div className="proj-chats">{chats.map(convRow)}</div>}
      </div>
    )
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-logo" src={logo} alt="" />
        <span className="brand-name">Troupe</span>
      </div>
      <div className="sidebar-scroll">
        <button className="nav-item" onClick={onOpenSearch}><Icon name="search" /> Search <span className="kbd">{OS_WORDS.mod}K</span></button>
        <button className={`nav-item ${activeProjectId === null && !notesActive && !memoryActive && !tasksActive && !skillsActive && !imageActive ? 'active' : ''}`} onClick={() => onSelectProject(null)}><Icon name="grid" /> Projects</button>
        <button className={`nav-item ${imageActive ? 'active' : ''}`} onClick={onOpenImage}><Icon name="image" /> Image</button>
        <button className={`nav-item ${notesActive ? 'active' : ''}`} onClick={onOpenNotes}><Icon name="file" /> Notes</button>
        <button className={`nav-item ${skillsActive ? 'active' : ''}`} onClick={onOpenSkills}><Icon name="flash" /> Skills</button>
        <button className={`nav-item ${tasksActive ? 'active' : ''}`} onClick={onOpenTasks}><Icon name="clock" /> Tasks</button>

        <div className="section-label section-label-row">
          <span>Projects</span>
          <button className="section-add" title="New project" onClick={onNewProject}><Icon name="plus" size="md" /></button>
        </div>
        {projects.length === 0 && <div className="sidebar-empty">No projects yet</div>}
        {projShown.map(projGroup)}
        {projects.length > PROJECTS_SHOWN && (
          <button className="view-more" onClick={() => setShowAllProjects((v) => !v)}>
            {showAllProjects ? 'View less' : `View more (${projects.length - PROJECTS_SHOWN})`}
          </button>
        )}
      </div>
      <div className="sidebar-footer">
        <button className={`nav-item ${memoryActive ? 'active' : ''}`} onClick={onOpenMemory}><Icon name="memory" /> Memory</button>
        <button className="nav-item" onClick={onOpenSettings}><Icon name="settings" /> Settings</button>
      </div>
      <ResizeHandle varName="--sidebar-w" edge="right" min={200} max={440} />
    </nav>
  )
}
