import { readFileSync, statSync } from 'fs'
import { ensureInside } from '../filesystem/fsService'
import { getConversation } from '../conversations/conversationsRepo'
import { getProject } from '../projects/projectsRepo'
import { getSetting } from '../database/settingsRepo'
import { countMessages, listMessagesFrom } from '../conversations/messagesRepo'
import { getLatestSnapshot } from '../conversations/snapshotRepo'
import { listContextFiles } from './contextRepo'
import { resolveProjectMemory, readGlobalMemory, memoryDelivery, globalMemoryDelivery } from './projectMemory'
import { buildContextBlock, formatTranscript } from '../agent/handoff'
import type { ProviderContext, ContextInspection, ContextSection, ContextFolders, Delivery } from '../../shared/agent'
import type { ProviderId } from '../../shared/types'
import { PROVIDERS, isProviderId } from '../../shared/providers'
import { mcpOffFor, MCP_OFF_SETTING } from '../../shared/projectMcp'
import { renderPinnedFile, memoryWarning, staleMemoryNote, renderScheduledTask, SINCE_SUMMARY_TRANSCRIPT } from '../../shared/contextBudget'
import { getScheduleByConv } from '../schedules/schedulesRepo'
import { decisionsContext, DECISIONS_FILE } from '../../shared/decisions'
import { listOutcomes } from './decisionsRepo'

const approxTokens = (s: string) => Math.ceil(s.length / 4)
const preview = (s: string, n = 240) => (s.length > n ? s.slice(0, n) + '…' : s)

interface PersistentContext { text: string; referenced: string[] }

// Pinned files (D-075): small ones inline, large ones as a reference the agent opens.
function persistentContext(projectId: string, folderPath: string | null): PersistentContext {
  if (!folderPath) return { text: '', referenced: [] }
  const parts: string[] = []
  const referenced: string[] = []
  for (const rel of listContextFiles(projectId)) {
    try {
      const r = renderPinnedFile(rel, readFileSync(ensureInside(folderPath, rel), 'utf8'))
      parts.push(r.text)
      if (!r.inlined) referenced.push(rel)
    } catch { /* skip unreadable */ }
  }
  if (parts.length === 0) return { text: '', referenced }
  return { text: ['# Persistent context (reference files for this project)', '', parts.join('\n\n')].join('\n'), referenced }
}
const readPersistentContext = (projectId: string, folderPath: string | null): string => persistentContext(projectId, folderPath).text

// D-084: the instruction of a scheduled task that reuses this thread, pinned ahead of
// the transcript so it never falls out through compression or transcript windows.
function scheduledTaskBlock(conversationId: string): string {
  const s = getScheduleByConv(conversationId)
  return s && s.target === 'same' && s.prompt.trim() ? renderScheduledTask(s.title, s.prompt) : ''
}

// Snapshot-aware conversation block: [pinned task] + summary (if any) + recent turns since it.
function conversationBlock(conversationId: string, excludeTrailing: number): string {
  // D-091: read only what is used — the turns after the summary, or (no summary yet) all.
  const total = Math.max(0, countMessages(conversationId) - Math.max(0, excludeTrailing))
  const pinned = scheduledTaskBlock(conversationId)
  if (total === 0) return pinned
  const snap = getLatestSnapshot(conversationId)
  const recent = snap && total > snap.throughCount ? listMessagesFrom(conversationId, snap.throughCount, total - snap.throughCount) : []
  const body = snap
    ? [
        '# Conversation summary so far (compressed)',
        snap.content,
        ...(recent.length ? ['', '# Recent turns since the summary', formatTranscript(recent, SINCE_SUMMARY_TRANSCRIPT), '', "Respond to the User's latest message using this shared context."] : [])
      ].join('\n')
    : buildContextBlock(listMessagesFrom(conversationId, 0, total))
  return pinned ? `${pinned}\n\n${body}` : body
}

export function buildProjectContext(conversationId: string): Pick<ProviderContext, 'instructions' | 'globalMemory' | 'memory' | 'persistentContext'> {
  const conv = getConversation(conversationId)
  const project = conv ? getProject(conv.projectId) : null
  return project ? projectStartingPack(project) : {}
}

// The starting pack every message in a project carries (D-080 item 3); also what
// Check context (D-082) hands a fresh run, so the check measures the real thing.
export function projectStartingPack(project: NonNullable<ReturnType<typeof getProject>>): Pick<ProviderContext, 'instructions' | 'globalMemory' | 'memory' | 'persistentContext'> {
  return {
    instructions: [getSetting('global_instructions')?.trim(), project.instructions?.trim()].filter(Boolean).join('\n\n') || undefined,
    globalMemory: readGlobalMemory()?.trim() || undefined,
    memory: resolveProjectMemory(project) || undefined,
    // Pinned files + the decisions log (D-081 step 5) travel together; the inspector shows them apart.
    persistentContext: [readPersistentContext(project.id, project.folderPath), decisionsContext(listOutcomes(project))].filter(Boolean).join('\n\n') || undefined
  }
}

// The additional folders a run may touch, resolved main-side from the conversation's
// project (D-054) — so chat, schedules and collab all get them with no call-site
// changes. Paths that no longer exist as directories are skipped: `--add-dir`
// validates each one and would otherwise fail the whole run.
const isDir = (dir: string): boolean => {
  try { return statSync(dir).isDirectory() } catch { return false }
}

export function resolveAddDirs(conversationId: string): string[] {
  const conv = getConversation(conversationId)
  const project = conv ? getProject(conv.projectId) : null
  if (!project) return []
  return project.extraFolders.filter(isDir)
}

// MCP servers switched off for this agent in Settings ▸ Tools (D-075 → global in D-077).
// Kept conversation-shaped so call sites don't change if per-project rules return.
export function resolveMcpOff(_conversationId: string, provider: ProviderId): string[] {
  return mcpOffFor(getSetting(MCP_OFF_SETTING), provider)
}

// The conversation transcript/summary for a run (excludes the current prompt).
export function buildConversationContext(conversationId: string, excludeTrailing = 1): string {
  return conversationBlock(conversationId, excludeTrailing)
}

// What the inspected provider will actually be sent (D-055 step 5). The four
// instruction/memory rows are always listed — including when empty or natively
// loaded — because "not delivered" and "the CLI loads this itself" are exactly
// what the inspector exists to show. Rows Workbench does not send (native) are
// shown but left out of the estimated total.
export function inspectContext(conversationId: string, providerId: ProviderId = 'claude-code'): ContextInspection {
  const conv = getConversation(conversationId)
  const project = conv ? getProject(conv.projectId) : null
  const globalInstructions = getSetting('global_instructions')?.trim() ?? ''
  const projectInstructions = project?.instructions?.trim() ?? ''
  const globalMemory = readGlobalMemory()?.trim() ?? ''
  const memory = project ? resolveProjectMemory(project) : ''
  const pc = project ? persistentContext(project.id, project.folderPath) : { text: '', referenced: [] }
  const persistent = pc.text
  const outcomes = project ? listOutcomes(project) : []
  const decisions = decisionsContext(outcomes)
  const pinnedTask = scheduledTaskBlock(conversationId)
  const convo = conversationBlock(conversationId, 0)

  // Instructions live in SQLite and reach the agent only because Workbench sends them.
  const sent = (v: string): Delivery => (v ? 'injected' : 'none')

  type Row = { name: string; text: string; delivery?: Delivery; source?: string; always?: boolean; warning?: string; note?: string }
  const rows: Row[] = [
    { name: 'Global Instructions', text: globalInstructions, delivery: sent(globalInstructions), source: 'Workbench settings', always: true },
    { name: 'Project Instructions', text: projectInstructions, delivery: sent(projectInstructions), source: 'Project settings', always: true },
    { name: 'Global Memory', text: globalMemory, delivery: globalMemoryDelivery(providerId, globalMemory), source: (isProviderId(providerId) && PROVIDERS[providerId].globalMemoryPath) || '~/.claude/CLAUDE.md', always: true, warning: memoryWarning('Global memory', globalMemory.length) },
    {
      name: 'Project Memory',
      text: memory,
      delivery: memoryDelivery(providerId, project?.folderPath ?? null, memory),
      source: project?.folderPath ? (providerId === 'codex' ? 'AGENTS.md' : 'CLAUDE.md') : 'Workbench database (no project folder)',
      always: true,
      warning: memoryWarning('Project memory', memory.length),
      note: staleMemoryNote(memory)
    },
    { name: 'Persistent Context', text: persistent, note: pc.referenced.length ? `Sent as references, not inlined (over 8 KB): ${pc.referenced.join(', ')}` : undefined },
    { name: 'Decisions log', text: decisions, delivery: sent(decisions), source: project?.folderPath ? DECISIONS_FILE : 'Workbench database (no project folder)', always: true, note: outcomes.length ? `${outcomes.length} entries · index of the latest ${Math.min(50, outcomes.length)} + the latest ${Math.min(3, outcomes.length)} in full` : 'Nothing saved yet — use Save outcome on a reply.' },
    { name: 'Conversation (summary + recent)', text: convo, note: pinnedTask ? 'Starts with the scheduled task, pinned so repeat runs keep it without re-sending the prompt.' : undefined }
  ]

  const INSPECT_CAP = 20000  // full-enough for the scrollable viewer, bounded for IPC
  const sections: ContextSection[] = rows
    .filter((r) => r.always || r.text.length > 0)
    .map((r) => ({
      name: r.name,
      chars: r.text.length,
      approxTokens: approxTokens(r.text),
      preview: preview(r.text),
      content: r.text.length > INSPECT_CAP ? r.text.slice(0, INSPECT_CAP) + '\n\n…[truncated for display]' : r.text,
      delivery: r.delivery,
      source: r.source,
      warning: r.warning,
      note: r.note
    }))
  // Natively-loaded sections are the provider's own file read — not part of what
  // Workbench sends, so they don't count towards the estimate.
  const totalChars = sections.filter((s) => s.delivery !== 'native').reduce((a, s) => a + s.chars, 0)
  // What the run can touch on disk (D-054) — the same list the providers receive.
  const folders: ContextFolders = {
    primary: project?.folderPath ?? null,
    extra: (project?.extraFolders ?? []).filter(isDir),
    missing: (project?.extraFolders ?? []).filter((d) => !isDir(d))
  }
  return { sections, totalChars, totalApproxTokens: Math.ceil(totalChars / 4), folders }
}
