import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import WindowNav from './components/WindowNav'
import ProjectHome from './components/ProjectHome'
import ProjectsOverview from './components/ProjectsOverview'
import NewProjectModal from './components/NewProjectModal'
import InstructionsEditor from './components/InstructionsEditor'
import ProvidersModal from './components/ProvidersModal'
import ContextManager from './components/ContextManager'
import MemoryEditor from './components/MemoryEditor'
import SkillsView from './components/SkillsView'
import { sendMessage, setActiveConversation } from './turnsStore'
import { loadModelLists } from './models'
import type { Tab as SettingsTab } from './components/SettingsModal'
import { OPEN_SETTINGS_EVENT } from './notices'
import FilesView from './components/FilesView'
import ConversationView from './components/ConversationView'
import NotesView from './components/NotesView'
import MemoryView from './components/MemoryView'
import SearchPalette from './components/SearchPalette'
import { useNavHistory } from './navHistory'
import { useProjects } from './hooks/useProjects'
import { useConversations } from './hooks/useConversations'
import { api } from './api'
import ErrorBoundary from './components/ErrorBoundary'
import Notices from './components/Notices'
import { notify, failed } from './notices'
import { loadAndApplyAppearance } from './appearance'
import { restorePanelWidths } from './components/ResizeHandle'
import { parseAgentMentions } from '../../shared/mentions'
import type { PendingAttachment } from './attachments'
import type { PermissionMode } from '../../shared/agent'
import type { SelectionItem } from '../../shared/selections'
import type { PendingSend } from './components/ConversationView'
import { useAgentList, loadAgentSettings } from './agents'
import type { NewProjectInput, ProjectPatch, ProviderId, RecentConversation, Note, ConnectFolderResult } from '../../shared/types'

// D-092: views opened rarely or later load on first use, keeping them out of the startup bundle.
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const SchedulesView = lazy(() => import('./components/SchedulesView'))
const ImageView = lazy(() => import('./components/image/ImageView'))

const titleFrom = (text: string) => {
  const line = text.trim().split('\n')[0]
  return line.length > 48 ? line.slice(0, 48) + '…' : line || 'New conversation'
}

const SIDEBAR_HIDDEN_KEY = 'sidebar.hidden'

export default function App() {
  const { projects, reorder: reorderProjects, create, update, remove, touch, connectFolder: connectProjectFolder, addFolder: addProjectFolder, removeFolder: removeProjectFolder } = useProjects()
  const agentList = useAgentList()
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const { conversations, refresh: refreshConvos, create: createConvo } = useConversations(activeProjectId)

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [allConvos, setAllConvos] = useState<RecentConversation[]>([])
  const [pendingOpenConv, setPendingOpenConv] = useState<string | null>(null)
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [editingMemory, setEditingMemory] = useState(false)
  const [memoryAppend, setMemoryAppend] = useState<string | null>(null)
  const [showSkills, setShowSkills] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  // Any view can open Settings on a tab (D-077: the side panel's "Manage" → Tools).
  useEffect(() => {
    const open = (e: Event) => { setSettingsTab(((e as CustomEvent).detail as SettingsTab) || 'general'); setShowSettings(true) }
    window.addEventListener(OPEN_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open)
  }, [])
  const [browsing, setBrowsing] = useState(false)
  const [showProviders, setShowProviders] = useState(false)
  const [showContextMgr, setShowContextMgr] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [showSchedules, setShowSchedules] = useState(false)
  const [showImage, setShowImage] = useState(false)
  // Image stays mounted once opened, so runs that finish while another view is on screen
  // still land on the canvas (results arrive as events to the mounted view — D-088).
  const [imageMounted, setImageMounted] = useState(false)
  useEffect(() => { if (showImage) setImageMounted(true) }, [showImage])

  // D-086: window chrome. The sidebar can be hidden (remembered), and every view
  // change is a step in a per-window history that Back/Forward walk.
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => { try { return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? '1' : '0') } catch { /* storage unavailable */ } }, [sidebarHidden])
  type Loc = { p: string | null; c: string | null; b: boolean; v: 'notes' | 'memory' | 'schedules' | 'skills' | 'image' | null }
  const locKey = JSON.stringify({ p: activeProjectId, c: activeConversationId, b: browsing, v: showNotes ? 'notes' : showMemory ? 'memory' : showSchedules ? 'schedules' : showSkills ? 'skills' : showImage ? 'image' : null } satisfies Loc)
  const applyLoc = (key: string) => {
    const l = JSON.parse(key) as Loc
    setShowNotes(l.v === 'notes'); setShowMemory(l.v === 'memory'); setShowSchedules(l.v === 'schedules'); setShowSkills(l.v === 'skills'); setShowImage(l.v === 'image')
    if (l.p !== activeProjectId) { setActiveProjectId(l.p); if (l.c) setPendingOpenConv(l.c) }
    else { setActiveConversationId(l.c); setBrowsing(l.b) }
  }
  const { canBack, canForward, goBack, goForward } = useNavHistory(locKey, applyLoc)
  const nav = { sidebarHidden, onToggleSidebar: () => setSidebarHidden((v) => !v), canBack, canForward, onBack: goBack, onForward: goForward }

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )
  const conversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  )

  const goBackRef = useRef<() => void>(() => {}); goBackRef.current = goBack
  const goForwardRef = useRef<() => void>(() => {}); goForwardRef.current = goForward
  useEffect(() => { loadAndApplyAppearance(); restorePanelWidths(['--sidebar-w', '--context-panel-w']); void loadAgentSettings() }, [])
  useEffect(() => { void loadModelLists() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setShowSearch((v) => !v) }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setSidebarHidden((v) => !v) }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '[') { e.preventDefault(); goBackRef.current() }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === ']') { e.preventDefault(); goForwardRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Tell the run store which chat is on screen, so a run finishing in any OTHER
  // conversation marks it unread (and opening it clears the dot).
  useEffect(() => { setActiveConversation(activeConversationId) }, [activeConversationId])
  // On project change, drop back to the project home — UNLESS we're navigating
  // straight to a specific conversation (pendingOpenConv). Blanking it in that
  // window briefly satisfied the project row's active condition, flashing it
  // highlighted (B-024).
  useEffect(() => {
    setBrowsing(false)
    if (!pendingOpenConv) setActiveConversationId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  const refreshConvList = () => { api.conversations.recent(500).then(setAllConvos) }
  useEffect(() => { refreshConvList() }, [projects, conversations])

  // Apply a cross-project "open conversation" once its project's list has loaded.
  useEffect(() => {
    if (pendingOpenConv && conversations.some((c) => c.id === pendingOpenConv)) {
      setBrowsing(false); setActiveConversationId(pendingOpenConv); setPendingOpenConv(null)
    }
  }, [conversations, pendingOpenConv])

  const openConversation = (projectId: string, convId: string) => {
    setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false)
    if (projectId === activeProjectId) { setBrowsing(false); setActiveConversationId(convId) }
    else { setActiveProjectId(projectId); touch(projectId); setPendingOpenConv(convId) }
  }

  const selectProject = (id: string | null) => { setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false); setActiveProjectId(id); setActiveConversationId(null); setBrowsing(false) }
  const openProject = (id: string) => { setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false); setActiveProjectId(id); touch(id) }

  // "Run now" a scheduled task interactively: make the thread, open it, and dispatch
  // through the normal run pipeline so the user sees it stream live.
  const runScheduleNow = async (s: import('../../shared/types').Schedule) => {
    const conv = await api.conversations.create(s.projectId, `${s.title || 'Task'} · now`, s.provider)
    await refreshConvos(); refreshConvList()
    openConversation(s.projectId, conv.id)
    const proj = projects.find((p) => p.id === s.projectId)
    sendMessage(conv.id, proj?.folderPath ?? undefined, s.prompt, s.provider, undefined, undefined, s.model ?? undefined, s.permissionMode)
  }

  const handleCreateProject = async (input: NewProjectInput) => {
    const p = await create(input)
    setShowNew(false)
    openProject(p.id)
  }

  const patchActive = (patch: ProjectPatch) => { if (project) update(project.id, patch) }

  const showToast = notify

  // What happened to the project's memory when its folder was connected (D-055).
  const migrationToast = (r: ConnectFolderResult): string | null => {
    if (r.memory === 'none') return null
    const where = r.memory === 'created'
      ? 'Memory moved into CLAUDE.md in the new folder.'
      : 'Memory appended to the folder\u2019s existing CLAUDE.md under \u201cImported from Workbench (pre-folder)\u201d.'
    const codex = r.mirror?.mirrored === false
      ? ' Codex has its own AGENTS.md here, so it will be injected instead of mirrored.'
      : ''
    return where + codex
  }

  const connectFolder = async () => {
    const folder = await api.dialog.selectFolder()
    if (!folder || !project) return
    const res = await connectProjectFolder(project.id, folder)
    const msg = migrationToast(res)
    if (msg) showToast(msg)
  }

  // Additional folders (D-054): picked with the same dialog as the primary folder.
  const addFolder = async () => {
    const folder = await api.dialog.selectFolder()
    if (!folder || !project) return
    if (folder === project.folderPath) { showToast('That is already the project folder.'); return }
    await addProjectFolder(project.id, folder)
  }

  const removeFolder = async (folder: string) => {
    if (!project) return
    await removeProjectFolder(project.id, folder)
  }

  // First message from the project page: the composer's whole payload (attachments,
  // skill, model, permission mode, selected passages) travels with it — the new
  // ConversationView sends it exactly as a message typed inside the chat would be.
  const startConversation = async (text: string, provider: ProviderId, attachments: PendingAttachment[] = [], skillId?: string, model?: string, permMode?: PermissionMode, selections?: SelectionItem[]) => {
    if (!project) return
    // Support @mentions on the very first message: title from the cleaned text,
    // and default the conversation's provider to the first addressed agent.
    const { targets, cleaned } = parseAgentMentions(text)
    const first = targets[0] ?? provider
    const conv = await createConvo(titleFrom(cleaned.trim() || text), first)
    setActiveConversationId(conv.id)
    setPendingSend({ text, provider: first, attachments, skillId, model, permMode, selections })
  }

  const startCollabConversation = async (goal: string, provider: ProviderId, permMode: PermissionMode, model?: string) => {
    if (!project || !project.folderPath) return
    const { targets, cleaned } = parseAgentMentions(goal)
    const first = targets[0] ?? provider
    const conv = await createConvo(titleFrom(cleaned.trim() || goal), first)
    await api.collab.start({ conversationId: conv.id, cwd: project.folderPath, providerId: first, model, permissionMode: permMode, goal }).catch(failed('Start collab'))
    setActiveConversationId(conv.id)
  }

  const selectConversation = (id: string) => { setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false); setBrowsing(false); setActiveConversationId(id) }
  const renameConversation = async (id: string, title: string) => { await api.conversations.rename(id, title); refreshConvos(); refreshConvList() }
  const setPinned = async (id: string, pinned: boolean) => { await api.conversations.setPinned(id, pinned); refreshConvos(); refreshConvList() }
  const deleteConversation = async (id: string) => {
    await api.conversations.remove(id)
    if (activeConversationId === id) setActiveConversationId(null)
    refreshConvos(); refreshConvList()
  }
  const exportConversation = async (id: string) => { await api.conversations.export(id) }
  const branchConversation = async (fromConvId: string, messageId: string | null) => {
    const conv = await api.conversations.branch(fromConvId, messageId)
    await refreshConvos(); refreshConvList()
    openConversation(conv.projectId, conv.id)
  }
  const duplicateConversation = (id: string) => branchConversation(id, null)
  const noteHeading = (n: Note) => (n.title.trim() || n.body.trim().split('\n')[0] || 'Untitled note').slice(0, 60)
  const noteToChat = async (note: Note, projectId: string) => {
    setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false)
    const conv = await api.conversations.create(projectId, titleFrom(noteHeading(note)), 'claude-code')
    if (projectId === activeProjectId) await refreshConvos()
    refreshConvList()
    openConversation(projectId, conv.id)
    if (note.body.trim()) setPendingSend({ text: note.body, provider: 'claude-code' })
  }
  const noteToProject = async (note: Note) => {
    setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false)
    const proj = await create({ name: noteHeading(note) })
    if (note.body.trim()) await update(proj.id, { instructions: note.body })
    openProject(proj.id)
  }
  const renameProject = (id: string, name: string) => update(id, { name })
  const deleteProject = async (id: string) => {
    await remove(id)
    if (activeProjectId === id) selectProject(null)
    refreshConvList()
  }

  // header breadcrumb
  const crumb = () => {
    if (showNotes) return <span className="crumb-current">Notes</span>
    if (showMemory) return <span className="crumb-current">Memory</span>
    if (showSchedules) return <span className="crumb-current">Tasks</span>
    if (showSkills) return <span className="crumb-current">Skills</span>
    if (showImage) return <span className="crumb-current">Image</span>
    if (!project) return <span className="crumb-current">Projects</span>
    return (
      <>
        <span className="crumb-link" onClick={() => selectProject(null)}>Projects</span>
        <span className="crumb-sep">/</span>
        {browsing ? (
          <>
            <span className="crumb-link" onClick={() => setBrowsing(false)}>{project.name}</span>
            <span className="crumb-sep">/</span><span className="crumb-current">Files</span>
          </>
        ) : conversation ? (
          <>
            <span className="crumb-link" onClick={() => setActiveConversationId(null)}>{project.name}</span>
            <span className="crumb-sep">/</span><span className="crumb-current truncate">{conversation.title}</span>
          </>
        ) : (
          <span className="crumb-current">{project.name}</span>
        )}
      </>
    )
  }

  return (
    <div className={`app${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      {!sidebarHidden && <ErrorBoundary label="Sidebar" compact>
      <Sidebar
        projects={projects}
        conversations={allConvos}
        activeProjectId={activeProjectId}
        activeConversationId={activeConversationId}
        onSelectProject={selectProject}
        onOpenConversation={openConversation}
        onNewProject={() => setShowNew(true)}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
        onExportConversation={exportConversation}
        onDuplicateConversation={duplicateConversation}
        onOpenSearch={() => setShowSearch(true)}
        onSetPinned={setPinned}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onReorderProjects={reorderProjects}
        onOpenNotes={() => { setShowNotes(true); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setShowImage(false); setActiveConversationId(null); setBrowsing(false) }}
        notesActive={showNotes}
        onOpenMemory={() => { setShowMemory(true); setShowNotes(false); setShowSchedules(false); setShowSkills(false); setShowImage(false); setActiveConversationId(null); setBrowsing(false) }}
        memoryActive={showMemory}
        onOpenTasks={() => { setShowSchedules(true); setShowNotes(false); setShowMemory(false); setShowSkills(false); setShowImage(false); setActiveConversationId(null); setBrowsing(false) }}
        tasksActive={showSchedules}
        onOpenSkills={() => { setShowSkills(true); setShowImage(false); setShowNotes(false); setShowMemory(false); setShowSchedules(false); setActiveConversationId(null); setBrowsing(false) }}
        skillsActive={showSkills}
        onOpenImage={() => { setShowImage(true); setShowNotes(false); setShowMemory(false); setShowSchedules(false); setShowSkills(false); setActiveConversationId(null); setBrowsing(false) }}
        imageActive={showImage}
        onOpenSettings={() => { setSettingsTab('general'); setShowSettings(true) }}
      />
      </ErrorBoundary>}
      <div className="main">
        <ErrorBoundary label="This view" resetKey={`${activeProjectId}|${activeConversationId}|${showNotes}|${showMemory}|${showSchedules}|${showSkills}|${showImage}|${browsing}`}>
        {!(showNotes || showMemory || showSchedules || showSkills || showImage || (project && browsing)) && <header className="main-header">{crumb()}</header>}

        {showNotes && (
          <NotesView projects={projects} onNoteToChat={noteToChat} onNoteToProject={noteToProject} />
        )}
        {showMemory && <MemoryView projects={projects} onChanged={() => refreshConvList()} />}
        {showSchedules && <Suspense fallback={null}><SchedulesView projects={projects} providers={agentList} onRun={runScheduleNow} /></Suspense>}
        {showSkills && <SkillsView projects={projects} />}
        {(showImage || imageMounted) && <div className={showImage ? 'img-host' : 'img-host hidden'}><Suspense fallback={null}><ImageView active={showImage} /></Suspense></div>}
        {!showNotes && !showMemory && !showSchedules && !showSkills && !showImage && !project && (
          <ProjectsOverview projects={projects} onOpen={openProject} onNew={() => setShowNew(true)} />
        )}
        {!showNotes && !showMemory && !showSchedules && !showSkills && !showImage && project && browsing && project.folderPath && (
          <FilesView root={project.folderPath} onBack={() => setBrowsing(false)} />
        )}
        {!showNotes && !showMemory && !showSchedules && !showSkills && !showImage && project && !browsing && conversation && (
          <ConversationView
            key={conversation.id}
            conversation={conversation}
            providers={agentList}
            pendingSend={pendingSend}
            onConsumePending={() => { setPendingSend(null); refreshConvos() }}
            cwd={project.folderPath ?? undefined}
            onAddToMemory={(content) => { setMemoryAppend(content); setEditingMemory(true) }}
            onBranch={branchConversation}
            onBrowseFiles={project.folderPath ? () => setBrowsing(true) : undefined}
          />
        )}
        {!showNotes && !showMemory && !showSchedules && !showSkills && !showImage && project && !browsing && !conversation && (
          <ProjectHome
            project={project}
            providers={agentList}
            conversations={conversations}
            onSelectConversation={selectConversation}
            onPatch={patchActive}
            onEditInstructions={() => setEditingInstructions(true)}
            onConnectFolder={connectFolder}
            onAddFolder={addFolder}
            onRemoveFolder={removeFolder}
            onBrowseFiles={() => project.folderPath && setBrowsing(true)}
            onStartConversation={startConversation}
            onStartCollab={startCollabConversation}
            onOpenProviders={() => setShowProviders(true)}
            onManageContext={() => setShowContextMgr(true)}
            onEditMemory={() => setEditingMemory(true)}
          />
        )}
        </ErrorBoundary>
      </div>

      <Notices />
      <ErrorBoundary label="Dialog" resetKey={`${activeProjectId}|${activeConversationId}`}>
      {showSettings && <Suspense fallback={null}><SettingsModal initialTab={settingsTab} onClose={() => setShowSettings(false)} /></Suspense>}
      {showProviders && <ProvidersModal onClose={() => setShowProviders(false)} />}
      {showContextMgr && project && <ContextManager projectId={project.id} folderPath={project.folderPath} onClose={() => setShowContextMgr(false)} />}
      {showNew && <NewProjectModal onCreate={handleCreateProject} onClose={() => setShowNew(false)} />}
      {showSearch && <SearchPalette onClose={() => setShowSearch(false)} onOpen={(pid, cid) => { setShowSearch(false); openConversation(pid, cid) }} />}
      {editingInstructions && project && (
        <InstructionsEditor
          initial={project.instructions}
          onSave={(value) => { patchActive({ instructions: value }); setEditingInstructions(false) }}
          onClose={() => setEditingInstructions(false)}
        />
      )}
      {editingMemory && project && (
        <MemoryEditor
          folderPath={project.folderPath}
          dbInitial={project.memory}
          append={memoryAppend}
          onSaveDb={(value) => patchActive({ memory: value })}
          onClose={() => { setEditingMemory(false); setMemoryAppend(null) }}
        />
      )}
      </ErrorBoundary>
      {/* Last in the DOM on purpose: Chromium resolves app-region rects in paint order, so a
          no-drag control painted after the drag headers stays clickable (it didn't before). */}
      <WindowNav {...nav} />
    </div>
  )
}
