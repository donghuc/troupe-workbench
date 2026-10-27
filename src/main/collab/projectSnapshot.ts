import { readdirSync, statSync } from 'fs'
import { join } from 'path'

// D-128: what changed in the project while a Maker worked — Troupe's own record, so a Reviewer
// doesn't have to prove it (Codex blocked a review because the folder wasn't a git repo and it
// couldn't tell who wrote the file or what else changed). Size + modified time per file; folders
// that are build output, dependencies or Troupe's own bookkeeping are left out.

const SKIP = new Set(['.git', 'node_modules', '.workbench', 'dist', 'build', 'out', '.next', '.cache', 'DerivedData', 'Pods', '.venv', 'venv', '__pycache__', 'target', '.gradle', '.idea', '.DS_Store'])
// Audit #9 (2026-10-26): the walk runs on the main process twice per Maker attempt; 20,000 files
// could hold it for a noticeable moment. Past 5,000 files the record says the change list is unknown.
const SNAPSHOT_LIMIT = 5_000

export type Snapshot = Map<string, string>

/** Every file's size and modified time, or null when the project is too big to list quickly. */
export function snapshot(root: string, limit = SNAPSHOT_LIMIT): Snapshot | null {
  const out: Snapshot = new Map()
  const walk = (abs: string, rel: string): boolean => {
    let entries
    try { entries = readdirSync(abs, { withFileTypes: true }) } catch { return true }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!walk(join(abs, e.name), r)) return false; continue }
      if (!e.isFile()) continue
      try { const st = statSync(join(abs, e.name)); out.set(r, `${st.size}:${Math.round(st.mtimeMs)}`) } catch { /* gone */ }
      if (out.size > limit) return false
    }
    return true
  }
  return walk(root, '') ? out : null
}

export interface SnapshotDiff { added: string[]; changed: string[]; removed: string[] }
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const added: string[] = [], changed: string[] = [], removed: string[] = []
  for (const [p, v] of after) { const b = before.get(p); if (b === undefined) added.push(p); else if (b !== v) changed.push(p) }
  for (const p of before.keys()) if (!after.has(p)) removed.push(p)
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() }
}
