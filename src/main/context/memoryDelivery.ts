import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { ensureInside } from '../filesystem/fsService'
import type { ProviderId } from '../../shared/types'
import type { Delivery } from '../../shared/agent'

// The pure half of project/global memory (D-055): reading the canonical file and
// deciding how a provider receives it. No Electron, no database — so it can be
// unit-tested (D-060 item 2). The write paths stay in projectMemory.ts.

export const MIRROR_MARK = '<!-- Mirrored from CLAUDE.md by Workbench. Edit CLAUDE.md; this file is regenerated. -->'

export const globalClaudePath = (): string => join(homedir(), '.claude', 'CLAUDE.md')
export const globalAgentsPath = (): string => join(homedir(), '.codex', 'AGENTS.md')

// Raw contents of the project's CLAUDE.md, or null if there is no folder / no file.
export function readMemoryFile(folderPath: string | null): string | null {
  if (!folderPath) return null
  try { return readFileSync(ensureInside(folderPath, 'CLAUDE.md'), 'utf8') } catch { return null }
}

// Global (user-level) memory: ~/.claude/CLAUDE.md, auto-loaded by Claude Code for
// every project; mirrored to ~/.codex/AGENTS.md for Codex.
export function readGlobalMemory(): string | null {
  try { return readFileSync(globalClaudePath(), 'utf8') } catch { return null }
}

// D-055 step 1: the one place that answers "what is this project's memory?".
// The folder's CLAUDE.md is canonical; the DB blob is the folderless fallback
// (and the pre-folder leftover). Every reader — context builder, inspector,
// overview — goes through this so they can never disagree.
export function resolveProjectMemory(p: { folderPath: string | null; memory: string }): string {
  return (p.folderPath ? readMemoryFile(p.folderPath)?.trim() : '') || p.memory?.trim() || ''
}

const stripMark = (s: string): string => s.replace(MIRROR_MARK, '').trim()

// The faithful-copy test, shared by both scopes (D-055 step 3): a mirror counts
// only when Workbench wrote it AND its body still matches the canonical text.
// A hand-written file has no marker; one edited outside Workbench no longer matches.
export function isMirrorOf(mirrorPath: string, canonical: string): boolean {
  try {
    const a = readFileSync(mirrorPath, 'utf8')
    return a.includes(MIRROR_MARK) && stripMark(a) === canonical
  } catch { return false }
}

// D-055 step 2: how a provider will actually receive the resolved memory.
// 'native'   — the CLI auto-loads its own file, which is a faithful copy of the
//              canonical CLAUDE.md, so Workbench must NOT inject (would double it).
// 'injected' — Workbench puts the resolved text in the prompt / system prompt.
// 'none'     — there is no memory to deliver.
// One sentence for both scopes and all providers: native only when the provider's
// own file is a faithful copy; otherwise inject. Never both, never neither.
export function memoryDelivery(provider: ProviderId, dir: string | null, resolved: string): Delivery {
  if (!resolved.trim()) return 'none'
  if (!dir) return 'injected'
  const canonical = readMemoryFile(dir)?.trim() ?? ''
  if (!canonical) return 'injected'                       // DB blob only
  if (provider === 'claude-code') return 'native'         // CLAUDE.md is the canonical file
  if (provider === 'grok' || provider === 'gemini') return 'injected'   // no known native memory file
  return isMirrorOf(ensureInside(dir, 'AGENTS.md'), canonical) ? 'native' : 'injected'
}

// Same rule at global scope: ~/.claude/CLAUDE.md is canonical (Claude auto-loads it
// in every session, so it is always native), ~/.codex/AGENTS.md is Codex's mirror.
// `agentsPath` is a parameter only so tests can point it at a temp file.
export function globalMemoryDelivery(provider: ProviderId, resolved: string, agentsPath: string = globalAgentsPath()): Delivery {
  const canonical = resolved.trim()
  if (!canonical) return 'none'
  if (provider === 'claude-code') return 'native'
  if (provider === 'grok' || provider === 'gemini') return 'injected'
  return isMirrorOf(agentsPath, canonical) ? 'native' : 'injected'
}
