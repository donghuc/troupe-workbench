import type { TurnState, TurnDelta, StartTurnInput, RegenerateInput } from './turns'
import type {
  Project, NewProjectInput, ProjectPatch, FileNode, FileChange,
  Conversation, RecentConversation, SearchHit, Message, NewMessageInput, ProviderId, CustomAgentId, AgentTools, McpAddInput, McpMutationResult, Note, NewNoteInput, MemoryOverview, MirrorResult, ConnectFolderResult, Schedule, NewScheduleInput, SchedulePatch, FileSearchResult, CollabRecoverAction } from './types'
import type { ProviderDescriptor, ProviderAvailability, ContextInspection, PermissionMode } from './agent'
import type { SetupEvent } from './agentSetup'
import type { CustomAgent, CustomAgentDraft, TestResult } from './customAgents'
import type { Skill, SkillInput, SkillScope } from './types'
import type { CollabRun, CollabStartInput, CollabTaskDraft } from './types'
import type { ModelLists } from './models'
import type { Outcome } from './decisions'
import type { CheckResult } from './contextCheck'
import type { ProviderId as PId } from './types'
import type { ProjectAttachment } from './attachmentPaths'
import type { VoiceStatus, VoiceModelId, VoiceResult, VoiceDownloadEvent } from './voice'
import type { Canvas, CanvasIndex, ImageRunInput, ImageRunDone, ImageRunEvent } from './imageCanvas'
export interface ContextCheckReport { agent: PId; results: CheckResult[]; passed: number; total: number }

export interface AppInfo { version: string; electron: string; chrome: string; node: string; platform: string }

// The surface exposed on window.workbench by the preload bridge.
export interface WorkbenchApi {
  platform: string
  projects: {
    list(): Promise<Project[]>
    get(id: string): Promise<Project | null>
    create(input: NewProjectInput): Promise<Project>
    update(id: string, patch: ProjectPatch): Promise<Project>
    touch(id: string): Promise<void>
    remove(id: string): Promise<void>
    // Set the project's folder, migrating any folderless memory into its CLAUDE.md (D-055).
    connectFolder(id: string, folderPath: string): Promise<ConnectFolderResult>
    // Additional folders the agent may read and edit (D-054) — `--add-dir`, not a second root.
    addFolder(id: string, folderPath: string): Promise<Project>
    removeFolder(id: string, folderPath: string): Promise<Project>
    reorder(orderedIds: string[]): Promise<void>
  }
  dialog: {
    selectFolder(): Promise<string | null>
  }
  files: {
    listTree(root: string, sub?: string): Promise<FileNode>
    readFile(root: string, relPath: string): Promise<string>
    readDataUrl(root: string, relPath: string): Promise<string>
    writeBinary(root: string, relPath: string, base64: string): Promise<void>
    writeFile(root: string, relPath: string, content: string): Promise<void>
    watchStart(root: string): Promise<void>
    watchStop(): Promise<void>
    search(root: string, query: string): Promise<FileSearchResult[]>
    existing(root: string, relPaths: string[]): Promise<string[]>   // the subset that exist on disk
    extractText(root: string, relPath: string): Promise<string>
    onChanged(cb: (change: FileChange) => void): () => void
  }
  attachments: {
    saveBinary(base64: string, name: string): Promise<string>
    extractPdf(absPath: string): Promise<string>
    list(root: string): Promise<ProjectAttachment[]>            // D-126
    remove(root: string, relPath: string): Promise<void>
  }
  outcomes: {   // decisions log (D-081)
    draft(conversationId: string, messageId?: string): Promise<Outcome>
    save(projectId: string, outcome: Outcome): Promise<Outcome>
    list(projectId: string): Promise<Outcome[]>
    check(projectId: string): Promise<ContextCheckReport>   // D-082: can a fresh chat answer what was decided?
  }
  projectMemory: {
    read(folderPath: string): Promise<string | null>
    write(folderPath: string, text: string): Promise<MirrorResult>
    globalRead(): Promise<string | null>
    globalWrite(text: string): Promise<MirrorResult>
    overview(): Promise<MemoryOverview>
    // Fold a hand-written AGENTS.md into CLAUDE.md and take over the mirror
    // (null folderPath = global scope). Returns the new canonical memory text.
    adopt(folderPath: string | null): Promise<string>
  }
  schedules: {
    list(): Promise<Schedule[]>
    create(input: NewScheduleInput): Promise<Schedule>
    update(id: string, patch: SchedulePatch): Promise<Schedule | null>
    remove(id: string): Promise<void>
    runNow(id: string): Promise<void>
  }
  conversations: {
    list(projectId: string): Promise<Conversation[]>
    recent(limit?: number): Promise<RecentConversation[]>
    get(id: string): Promise<Conversation | null>
    create(projectId: string, title: string, provider: ProviderId): Promise<Conversation>
    rename(id: string, title: string): Promise<Conversation>
    remove(id: string): Promise<void>
    /** Files this chat attached (its own attachments folder) — said in the delete confirmation. */
    attachmentCount(id: string): Promise<number>
    setPinned(id: string, pinned: boolean): Promise<void>
    setPermissionMode(id: string, mode: string): Promise<void>
    branch(id: string, throughMessageId: string | null): Promise<Conversation>
    export(id: string): Promise<string | null>
    search(query: string): Promise<SearchHit[]>
    onCompressing(cb: (p: { conversationId: string; state: 'start' | 'end' }) => void): () => void
    onChanged(cb: () => void): () => void   // D-117: chats created outside the window
    compressNow(conversationId: string): Promise<void>
  }
  messages: {
    list(conversationId: string): Promise<Message[]>
    deleteFrom(conversationId: string, messageId: string): Promise<void>
    append(input: NewMessageInput): Promise<Message>
  }
  providers: {
    list(): Promise<ProviderDescriptor[]>
  }
  // Agent setup (2.3, Part A): the window names an agent; the command comes from its bundled recipe.
  agents: {
    setupStart(id: ProviderId | string, kind: 'install' | 'signIn', terminal?: boolean): Promise<{ runId: string | null; mode: 'run' | 'terminal' | 'none' }>
    setupCancel(runId: string): Promise<void>
    check(id: ProviderId, fresh?: boolean): Promise<ProviderAvailability>
    onEvent(cb: (e: SetupEvent) => void): () => void
  }
  // User-added agents (2.4, Part B). Save/remove push the new list to every window.
  customAgents: {
    list(): Promise<CustomAgent[]>
    save(draft: CustomAgentDraft, id?: CustomAgentId): Promise<CustomAgent>
    remove(id: CustomAgentId): Promise<void>
    test(draft: CustomAgentDraft, id?: CustomAgentId): Promise<TestResult>
    presets(): Promise<{ id: string; found: string | null }[]>   // bundled presets and the binary found for each
    onChanged(cb: (list: CustomAgent[]) => void): () => void
  }
  turns: {
    start(input: StartTurnInput): Promise<TurnState>
    regenerate(input: RegenerateInput): Promise<TurnState>
    cancel(conversationId: string): Promise<void>
    compare(conversationId: string): Promise<TurnState>   // Compare card over the replies since the last user message (D-081)
    get(conversationId: string): Promise<TurnState>
    snapshot(): Promise<TurnState[]>
    onChanged(cb: (state: TurnState) => void): () => void
    onDelta(cb: (delta: TurnDelta) => void): () => void   // D-094
  }
  context: {
    list(projectId: string): Promise<string[]>
    add(projectId: string, relPath: string): Promise<void>
    remove(projectId: string, relPath: string): Promise<void>
    // providerId: the composer's current provider — memory delivery differs per provider (D-055).
    inspect(conversationId: string, providerId?: ProviderId): Promise<ContextInspection>
  }
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  system: {
    tools(provider: ProviderId, cwd?: string): Promise<AgentTools>
    mcpAdd(input: McpAddInput, cwd?: string): Promise<McpMutationResult>
    mcpRemove(name: string, scope?: string, cwd?: string): Promise<McpMutationResult>
    lookup(): Promise<void>
    openArtifactWindow(root: string, relPath: string): Promise<void>
    revealItem(root: string, relPath: string): Promise<void>
    revealOutside(absPath: string): Promise<boolean>
    importOutside(root: string, absPath: string): Promise<string | null>
    openItem(root: string, relPath: string): Promise<boolean>
    appInfo(): Promise<AppInfo>
    autoModels(): Promise<ModelLists>   // each agent's own model list: Codex (models_cache.json, D-076), Gemini (`agy models`, D-079)
    openLogs(): Promise<boolean>
    diagnostics(): Promise<string>   // D-103: scrubbed text for a bug report
    logRendererError(where: string, message: string, detail?: string): Promise<void>
    copyImage(root: string, relPath: string): Promise<boolean>
    cliStatus(): Promise<{ enabled: boolean; open: boolean; socket: string }>   // D-117
    cliInstall(): Promise<{ path: string; onPath: boolean }>
  }
  notes: {
    list(): Promise<Note[]>
    get(id: string): Promise<Note | null>
    create(input: NewNoteInput): Promise<Note>
    update(id: string, patch: { title?: string; body?: string }): Promise<Note>
    remove(id: string): Promise<void>
  }
  skills: {
    list(cwd?: string): Promise<Skill[]>
    create(input: SkillInput, cwd?: string): Promise<Skill>
    update(id: string, patch: Partial<SkillInput>, cwd?: string): Promise<Skill>
    remove(id: string, cwd?: string): Promise<void>
    draft(purpose: string, scope: SkillScope, cwd?: string): Promise<Skill>
    reset(id: string): Promise<Skill | null>
    onChanged(cb: () => void): () => void
  }
  voice: {   // voice input (D-124)
    status(): Promise<VoiceStatus>
    download(id: VoiceModelId): Promise<void>
    cancelDownload(id: VoiceModelId): Promise<void>
    remove(id: VoiceModelId): Promise<void>
    setPrefs(prefs: { model?: VoiceModelId; language?: string }): Promise<VoiceStatus>
    prepare(): Promise<void>   // load the model while you talk
    transcribe(pcm: ArrayBuffer): Promise<VoiceResult>   // 16 kHz mono s16le
    cancel(): Promise<void>
    micAccess(): Promise<string>   // 'granted' | 'denied' | 'restricted' | …
    onEvent(cb: (e: VoiceDownloadEvent) => void): () => void
  }
  image: {   // image canvas (D-088)
    folder(): Promise<string | null>
    pickFolder(): Promise<string | null>
    // Canvases (D-102): one file each; the index is the tab list + the active tab.
    canvases(): Promise<CanvasIndex>
    load(id: string): Promise<Canvas>
    save(id: string, canvas: Canvas): Promise<void>
    clear(id: string): Promise<Canvas>
    setActive(id: string): Promise<CanvasIndex>
    createCanvas(after?: string): Promise<CanvasIndex>
    renameCanvas(id: string, name: string): Promise<CanvasIndex>
    duplicateCanvas(id: string): Promise<CanvasIndex>
    deleteCanvas(id: string): Promise<CanvasIndex>
    importMedia(base64: string, name: string): Promise<string>   // → path relative to the Image folder
    run(input: ImageRunInput): Promise<string>                    // → runId
    cancel(runId: string): Promise<void>
    saveImage(rel: string, hint: string): Promise<string>   // copy into saved/ → saved path
    unsaveImage(savedRel: string): Promise<void>            // remove the copy from saved/
    deleteRun(runId: string, fromCanvas?: string): Promise<boolean>   // delete outputs/<runId>/ unless another canvas still uses it
    onEvent(cb: (e: ImageRunEvent) => void): () => void
    onDone(cb: (d: ImageRunDone) => void): () => void
  }
  collab: {
    start(input: CollabStartInput): Promise<CollabRun>
    confirmPlan(runId: string, editedTasks?: CollabTaskDraft[]): Promise<CollabRun | null>
    stop(runId: string): Promise<CollabRun | null>
    setMode(runId: string, mode: 'read' | 'auto'): Promise<CollabRun | null>   // D-127: before approving, or while paused
    resume(runId: string, opts?: { raiseBudget?: boolean }): Promise<CollabRun | null>
    /** D-109: fix a failed task on a paused run — retry with a note, reassign, skip, or ask the Planner. */
    recover(runId: string, taskId: string, action: CollabRecoverAction): Promise<CollabRun | null>
    /** D-109: apply one of the Planner's repair options (index into run.repair.options). */
    applyRepair(runId: string, index: number): Promise<CollabRun | null>
    get(runId: string): Promise<CollabRun | null>
    list(conversationId: string): Promise<CollabRun[]>
    onChanged(cb: () => void): () => void
  }
}
