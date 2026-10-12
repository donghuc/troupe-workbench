import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { ensureInside } from '../filesystem/fsService'
import { listProjects } from '../projects/projectsRepo'
import type { MemoryOverview, MirrorResult } from '../../shared/types'
import {
  MIRROR_MARK, globalClaudePath, globalAgentsPath, readMemoryFile, readGlobalMemory, resolveProjectMemory
} from './memoryDelivery'

// D-028: a project's memory lives in the folder's CLAUDE.md (canonical), mirrored
// to AGENTS.md so Codex picks it up. The read/decide half lives in memoryDelivery.ts
// (pure, unit-tested); this file owns the write paths and the DB-backed overview.
export {
  readMemoryFile, readGlobalMemory, resolveProjectMemory, memoryDelivery, globalMemoryDelivery
} from './memoryDelivery'

// Write the marked mirror, unless the file on disk is someone else's (no marker) —
// D-028's merge-not-clobber. `force` is used only by adoptAgentsFile, once that
// file's content has been folded into the canonical CLAUDE.md. The result is
// reported back to the UI so a skipped mirror is never silent (D-055 step 4, B3).
function mirror(path: string, text: string, force: boolean): MirrorResult {
  if (!force && existsSync(path)) {
    let owned: boolean
    try { owned = readFileSync(path, 'utf8').includes(MIRROR_MARK) } catch { return { mirrored: false, reason: 'unreadable' } }
    if (!owned) return { mirrored: false, reason: 'hand-written' }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${MIRROR_MARK}\n\n${text}`, 'utf8')
  return { mirrored: true }
}

// Write memory to CLAUDE.md (canonical) and mirror to AGENTS.md.
export function writeMemory(folderPath: string, text: string): MirrorResult {
  writeFileSync(ensureInside(folderPath, 'CLAUDE.md'), text, 'utf8')
  return mirror(ensureInside(folderPath, 'AGENTS.md'), text, false)
}

export function writeGlobalMemory(text: string): MirrorResult {
  const c = globalClaudePath()
  mkdirSync(dirname(c), { recursive: true })
  writeFileSync(c, text, 'utf8')
  return mirror(globalAgentsPath(), text, false)
}

// D-055 step 4: fold a hand-written AGENTS.md into the canonical CLAUDE.md, then
// take over the mirror so the provider's file is a faithful copy again. Explicit,
// one-time, user-initiated — never automatic. `folderPath` null = global scope.
// Returns the new canonical memory text.
export function adoptAgentsFile(folderPath: string | null): string {
  const agentsPath = folderPath ? ensureInside(folderPath, 'AGENTS.md') : globalAgentsPath()
  const canonical = (folderPath ? readMemoryFile(folderPath) : readGlobalMemory())?.trim() ?? ''
  let hand = ''
  try { hand = readFileSync(agentsPath, 'utf8') } catch { /* nothing to adopt */ }
  // A file that already carries our marker is ours; there is nothing to import.
  const imported = hand.includes(MIRROR_MARK) ? '' : hand.trim()
  const merged = imported
    ? [canonical, '## Imported from AGENTS.md', imported].filter(Boolean).join('\n\n')
    : canonical
  const claudePath = folderPath ? ensureInside(folderPath, 'CLAUDE.md') : globalClaudePath()
  mkdirSync(dirname(claudePath), { recursive: true })
  writeFileSync(claudePath, merged, 'utf8')
  mirror(agentsPath, merged, true)
  return merged
}

// A roll-up of where memory currently lives: global + each project (CLAUDE.md for
// folder projects, the DB blob for folderless ones).
export function memoryOverview(): MemoryOverview {
  const g = readGlobalMemory()?.trim() ?? ''
  const projects = listProjects().map((p) => {
    const text = resolveProjectMemory(p)
    return { id: p.id, name: p.name, folderPath: p.folderPath, chars: text.length }
  })
  return { global: { chars: g.length }, projects }
}
