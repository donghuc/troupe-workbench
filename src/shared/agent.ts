import type { ProviderId } from './types'

// Context assembled per request (spec §31). Phase 9 fills these in fully.
export interface ProviderContext {
  instructions?: string
  globalMemory?: string    // ~/.claude/CLAUDE.md — user-level memory (D-055)
  memory?: string
  persistentContext?: string
  attachments?: string[]   // absolute paths (reserved)
  attachmentsText?: string // task attachment contents for this turn (spec §29)
  skillText?: string       // selected skill body for this turn (spec §57)
  snapshot?: string        // shared conversation transcript (D-009)
}

export type PermissionMode = 'read' | 'auto' | 'full'

export interface AgentRequest {
  prompt: string
  context: ProviderContext
  cwd: string              // project folder (or a scratch dir if none)
  // Additional folders this run may read and edit, beyond `cwd` (D-054). Passed to
  // each CLI as `--add-dir`; already filtered to paths that exist as directories.
  addDirs?: string[]
  model?: string
  permissionMode?: PermissionMode
  allowWeb?: boolean       // with 'read': also allow web search/fetch, still no file writes or shell (D-064)
  mcpOff?: string[]        // MCP server names switched off for this project (D-075)
  images?: string[]        // reference images (absolute paths) attached to the prompt — Codex `--image` (D-088)
  toolProfile?: 'image'    // Image canvas run (D-088): only what image generation needs, auto-approved
}

// What a provider can do — from the Phase 0 asymmetries.
export interface ProviderCapabilities {
  streaming: boolean
  streamingDeltas: boolean        // Claude: true, Codex exec: false
  sessionResume: boolean
  fileRead: boolean
  fileWrite: boolean
  shell: boolean
  web: boolean
  mcp: boolean
  images: boolean
  structuredOutput: boolean
  systemPromptInjection: boolean  // Claude: true, Codex: false (preamble instead)
  permissionModel: 'per-tool' | 'sandbox-level' | 'none'
}

// Token usage for one run. Claude reports cache reads/writes separately from
// fresh input; keeping them apart shows whether prompt caching is helping.
export interface TokenUsage {
  inputTokens?: number        // fresh (uncached) input
  cacheReadTokens?: number    // read from prompt cache (cheap)
  cacheCreationTokens?: number // written to prompt cache (~full price)
  outputTokens?: number
  costUsd?: number
}

// Normalized events (spec §47, extended by Phase 0 findings:
// session_started + permission_request added).
export type AgentEvent =
  | { type: 'session_started'; providerSessionId: string; model?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'status'; message: string }
  | { type: 'tool_start'; tool: string; input?: unknown; itemId?: string }
  | { type: 'tool_end'; tool: string; isError?: boolean; itemId?: string }
  | { type: 'file_changed'; path: string; kind?: 'created' | 'modified' | 'deleted' }
  | { type: 'permission_request'; tool: string; input?: unknown }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'complete'; usage?: TokenUsage }

// One persisted step an agent took during a run (Agent Activity timeline).
export interface AgentAction {
  kind: 'tool' | 'file'
  label: string
  detail?: string
  path?: string   // raw, untruncated file path (for opening in the artifact viewer)
  at: number
}

export interface ProviderAvailability {
  installed: boolean
  authenticated: boolean
  path?: string
  detail?: string
}

export interface ProviderDescriptor {
  id: ProviderId
  name: string
  capabilities: ProviderCapabilities
  availability: ProviderAvailability
}

// How a piece of memory reaches a provider (D-055): 'native' = the CLI auto-loads
// its own file, so Workbench must not send it; 'injected' = Workbench sends it;
// 'none' = there is nothing to deliver.
export type Delivery = 'native' | 'injected' | 'none'

// Context Inspector: one row per context section (spec §32).
export interface ContextSection {
  name: string
  chars: number
  approxTokens: number
  preview: string
  content: string
  delivery?: Delivery   // how this section reaches the inspected provider
  source?: string       // where it comes from (file or store), for the badge
  warning?: string      // over a size budget (D-075)
  note?: string         // neutral detail, e.g. pinned files sent as references
}
// Which folders the next run may read and edit (D-054). `extra` is what will actually
// be passed as --add-dir; `missing` is configured but skipped (no longer a directory),
// so the inspector never implies a folder is reachable when it is not.
export interface ContextFolders {
  primary: string | null
  extra: string[]
  missing: string[]
}

export interface ContextInspection {
  sections: ContextSection[]
  totalChars: number
  totalApproxTokens: number
  folders: ContextFolders
}
