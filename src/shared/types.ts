// Shared between main and renderer. Provider-generic — no Claude/Codex specifics here.

import type { PermissionMode } from './agent'

export interface Project {
  id: string
  name: string
  description: string
  instructions: string
  memory: string
  folderPath: string | null
  // Additional folders the agent may read and edit, beyond the primary folder
  // (D-054). They are passed to each CLI as `--add-dir`; the primary folder still
  // owns memory, skills, .mcp.json, attachments, the file browser and the watcher.
  extraFolders: string[]
  sortOrder: number
  createdAt: number
  lastOpenedAt: number
}

// Fields the user can set when creating a project.
export interface Note {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
}
export interface NewNoteInput { title?: string; body?: string }

export interface NewProjectInput {
  name: string
  description?: string
}

// Partial update to an existing project.
export interface ProjectPatch {
  name?: string
  description?: string
  instructions?: string
  memory?: string
  folderPath?: string | null
}

export type SkillScope = 'global' | 'project'
export interface Skill {
  id: string          // `${scope}/${slug}` — resolves to a SKILL.md file
  name: string
  description: string // frontmatter description (Claude Code uses it to auto-invoke)
  body: string
  triggers: string    // our custom frontmatter key: comma/newline keywords for auto-match (D-017)
  scope: SkillScope
  builtin?: boolean   // true for app-shipped system skills (global) — badge + reset-to-default (D-049)
}
export interface SkillInput {
  name: string
  description?: string
  body: string
  triggers?: string
  scope: SkillScope
}

export interface SessionSnapshot {
  id: string
  conversationId: string
  content: string
  throughCount: number
  providerId: ProviderId | null
  createdAt: number
}

export interface ConversationSummary {
  id: string
  projectId: string
  title: string
}

/** The four agents Troupe ships with a runner for. */
export type BuiltinProviderId = 'claude-code' | 'codex' | 'grok' | 'gemini'
/** A user-added agent (2.4). The prefix keeps it from ever colliding with a future built-in. */
export type CustomAgentId = `x-${string}`
export type ProviderId = BuiltinProviderId | CustomAgentId

export interface ProviderInfo {
  id: ProviderId
  name: string
  installed: boolean
  authenticated: boolean
}

// ---- Phase 3: filesystem ----
export interface FileNode {
  name: string
  // path relative to the project folder root, POSIX-style ('' for root)
  relPath: string
  type: 'file' | 'dir'
  mtime?: number   // file modified time (ms); files only
  children?: FileNode[]
  // dirs only (D-068): contents not walked — 'heavy' (generated folder or bundle), 'depth' or 'limit' cap.
  truncated?: 'heavy' | 'depth' | 'limit'
}

export interface FileChange {
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  relPath: string
}

export interface FileSearchHit { line: number; text: string }
export interface FileSearchResult { relPath: string; hits: FileSearchHit[] }

// ---- Phase 4: conversations ----
export interface Conversation {
  id: string
  projectId: string
  title: string
  provider: ProviderId
  model: string | null
  permissionMode: string | null   // last chosen in the composer; null = never chosen
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface RecentConversation extends Conversation {
  projectName: string
}

export interface McpServer {
  name: string
  detail?: string
  status: 'connected' | 'failed' | 'pending' | 'unknown'
}

export type McpScope = 'user' | 'local' | 'project'
export interface McpKeyVal { key: string; value: string }
export interface McpAddInput {
  name: string
  transport: 'stdio' | 'http'
  commandOrUrl: string
  args?: string[]
  env?: McpKeyVal[]
  headers?: McpKeyVal[]
  scope: McpScope
}
export interface McpMutationResult { ok: boolean; error?: string; warning?: string; removedFrom?: string[] }

export interface AgentTools {
  provider: ProviderId
  builtin: string[]
  mcp: McpServer[]
}

export interface SearchHit {
  conversationId: string
  projectId: string
  projectName: string
  title: string
  snippet: string
  kind: 'title' | 'message'
}

export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  provider: ProviderId | null
  content: string
  createdAt: number
  metadata: Record<string, unknown> | null
}

export interface NewMessageInput {
  conversationId: string
  role: MessageRole
  provider?: ProviderId | null
  content: string
  metadata?: Record<string, unknown> | null
}

// Outcome of connecting a folder to a project (D-055 step 6). Memory written
// while the project was folderless is migrated into the folder's CLAUDE.md so the
// UI and the runner can never disagree about where memory lives.
export interface ConnectFolderResult {
  project: Project
  memory: 'none' | 'created' | 'merged'   // what happened to the DB memory blob
  mirror?: MirrorResult                   // whether AGENTS.md was mirrored, if memory moved
}

// Outcome of writing memory: whether the provider mirror (AGENTS.md) was written,
// and if not, why — so the UI can offer to adopt a hand-written file (D-055).
export interface MirrorResult {
  mirrored: boolean
  reason?: 'hand-written' | 'unreadable'
}

export interface MemoryOverview {
  global: { chars: number }
  projects: Array<{ id: string; name: string; folderPath: string | null; chars: number }>
}

export type ScheduleKind = 'interval' | 'daily'
export type ScheduleTarget = 'new' | 'same'
export interface Schedule {
  id: string
  projectId: string
  title: string
  prompt: string
  provider: ProviderId
  model: string | null
  permissionMode: import('./agent').PermissionMode
  kind: ScheduleKind
  intervalMin: number   // every N minutes (kind = 'interval')
  atMin: number         // minutes past local midnight (kind = 'daily')
  enabled: boolean
  target: ScheduleTarget
  convId: string | null
  nextRunAt: number
  lastRunAt: number | null
  createdAt: number
  /** D-134: who made it — the app, or a bot over the command line. */
  createdVia: 'app' | 'cli'
  /** D-134: "Bots can manage this task" — bots may edit and delete it (tasks they made: on). */
  botManaged: boolean
  /** D-134: a bot's change waiting for you in Tasks (the task is paused meanwhile). */
  pending: SchedulePending | null
}
/** A command-line change waiting for approval: a new task, an edit to a Full-access task, or its deletion. */
export interface SchedulePending {
  kind: 'new' | 'edit' | 'delete'
  at: number
  patch?: SchedulePatch          // edit: what the bot asked to change
  before?: SchedulePatch         // edit: those fields as they were
  wasEnabled?: boolean           // edit / delete: restored on Discard, kept on Approve
}
export interface NewScheduleInput {
  projectId: string
  title: string
  prompt: string
  provider: ProviderId
  model?: string | null
  permissionMode?: import('./agent').PermissionMode
  kind: ScheduleKind
  intervalMin?: number
  atMin?: number
  target?: ScheduleTarget
  createdVia?: 'app' | 'cli'
  botManaged?: boolean
  enabled?: boolean
  pending?: SchedulePending | null
}
export interface SchedulePatch {
  title?: string
  prompt?: string
  provider?: ProviderId
  model?: string | null
  permissionMode?: import('./agent').PermissionMode
  kind?: ScheduleKind
  intervalMin?: number
  atMin?: number
  target?: ScheduleTarget
  enabled?: boolean
}


// ─── Collab mode (multi-agent runs) ──────────────────────────────────────────
export type CollabStatus =
  | 'planning'              // Planner run in flight
  | 'awaiting_confirmation' // plan ready; waiting on the human (mandatory gate)
  | 'running'               // executing tasks sequentially
  | 'needs_attention'       // paused: task failed after retries, or budget cap hit
  | 'done'
  | 'stopped'
  | 'failed'

export type CollabTaskStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped'
export type CollabTaskKind = 'work' | 'review'

export interface CollabBudget {
  maxTasks: number
  maxRuns: number
  maxRetriesPerTask: number
  maxTokens?: number
}
export interface CollabSpent { runs: number; tokens?: number; retryRuns?: number /* runs spent re-doing a task that failed */ }
export interface CollabVerdict { verdict: 'PASS' | 'FAIL'; findings: string[] }
export interface CollabHandoff { status: string; filesChanged: string[]; verify: string }

export interface CollabTask {
  id: string
  runId: string
  seq: number
  title: string
  kind: CollabTaskKind
  provider: ProviderId | null   // per-task Maker provider override
  model: string | null         // per-task Maker model override
  scope: string
  acceptance: string
  dependsOn: string[]
  status: CollabTaskStatus
  attempts: number
  lastVerdict: CollabVerdict | null
  handoff: CollabHandoff | null
  makerRunId: string | null
  reviewerRunId: string | null
  meta: CollabTaskMeta
}

// D-109: per-task recovery state.
export interface CollabTaskMeta {
  note?: string          // the user's (or a repair's) instruction for the next Maker attempt
  sig?: string           // signature of the last failure, to spot the same failure repeating
  outHash?: string       // hash of the task's output files at the last failure (unchanged → same failure)
  sameFails?: number     // how many failures in a row had that signature
  repairs?: number       // automatic Planner repairs applied to this task
  skipNote?: string      // why it was skipped, for tasks that build on it
  history?: string[]     // plan changes made to this task (reassign, rewrite, skip…)
  startedAt?: number     // D-121: first time this task started (ms)
  finishedAt?: number    // D-121: when it last passed, failed or was skipped (ms)
  startHash?: string     // D-121: its output files' fingerprint when the current attempt started
  repairSig?: string     // D-121: the failure an automatic Planner fix was meant to cure
  reviewer?: ProviderId  // D-121: who reviews this task (the Planner's or the user's pick); unset = the run's agent
  tries?: CollabTry[]    // D-121: every attempt, kept across retries, reassignments and reworks (attempts resets)
  blockedReviewers?: ProviderId[]  // D-121: reviewers that couldn't open the files for this task
  lastFailKind?: 'review' | 'unchanged'  // D-121: what the last failure was, for the unchanged-files check
  recorded?: CollabRecord   // D-128: what Troupe saw happen during the last Maker attempt
}
/** D-128: Troupe's own record of a Maker attempt, given to Reviewers as fact. */
export interface CollabRecord {
  by: ProviderId
  savedByTroupe: boolean     // files saved from the reply (Read-only run or text-only agent)
  added: string[]; changed: string[]; removed: string[]
  complete: boolean          // false: the project was too big to list, so the lists are empty
}
/** One attempt at a task (D-121), for the wrap-up and `troupe collab status`. */
export interface CollabTry { agent: ProviderId; result?: 'passed' | 'failed' | 'blocked'; why?: string }
export type CollabRecoverAction =
  | { type: 'retry'; note?: string }
  | { type: 'reassign'; provider: ProviderId; note?: string }
  | { type: 'skip'; note?: string }
  | { type: 'repair'; note?: string }
export interface CollabRepairOption {
  label: string
  action: 'retry' | 'reassign' | 'rewrite' | 'skip' | 'rework' | 'mode'   // 'mode' (D-127): Troupe's own fix, never from the Planner
  mode?: 'auto'
  changesGoal: boolean
  taskSeq?: number    // D-121 'rework' (final review failed): the work task to redo, 0-based
  goal?: string       // D-121: the corrected goal, when the goal itself is the problem (applied only by the user)
  provider?: ProviderId
  title?: string
  scope?: string
  acceptance?: string
  note?: string
  userStep?: string   // something the user must do first, outside Troupe (e.g. add README.md)
}
export interface CollabRepair { taskId: string; summary: string; options: CollabRepairOption[]; recommended: number }

export interface CollabRun {
  id: string
  conversationId: string
  projectCwd: string       // Collab requires a folder — always a real path
  providerId: ProviderId
  permissionMode: PermissionMode
  model: string           // run-level default Maker model ('' = provider default)
  goal: string
  outputDir: string       // visible project-relative folder for deliverables ('' on runs before D-064)
  status: CollabStatus
  budget: CollabBudget
  spent: CollabSpent
  reason: string           // needs_attention / failed / stopped reason
  repair: CollabRepair | null  // a Planner fix waiting for the user's choice (D-109)
  summary: string
  createdAt: number
  updatedAt: number
  tasks?: CollabTask[]      // hydrated by getCollabRun
}

export interface CollabStartInput {
  conversationId: string
  cwd: string              // required — the project folder
  providerId: ProviderId
  model?: string           // run-level default Maker model
  permissionMode?: PermissionMode
  goal: string
  budget?: Partial<CollabBudget>
}

// A plan task as proposed by the Planner / edited by the user before confirm.
export interface CollabTaskDraft {
  title: string
  kind?: CollabTaskKind
  provider?: ProviderId
  model?: string
  scope?: string
  acceptance?: string
  dependsOn?: string[]     // by seq index or task id; resolved on persist
  reviewer?: ProviderId    // D-121: who reviews it; unset = the run's agent
}

export const DEFAULT_COLLAB_BUDGET: CollabBudget = { maxTasks: 8, maxRuns: 24, maxRetriesPerTask: 1 }
