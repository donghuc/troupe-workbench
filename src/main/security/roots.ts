import { app } from 'electron'
import { join } from 'path'
import { getDb } from '../database/db'
import { matchRoot, expectString } from './pathGuard'
import { IMAGE_FOLDER_SETTING } from '../../shared/imageCanvas'

// DB-backed allow-list of directories the renderer may name as a file root (D-060
// item 6, audit #7). Before this, any `root` string from the renderer was accepted and
// `ensureInside` only kept `rel` under it, so a renderer bug could read or write
// anywhere the user can. Now a root must be a project's primary folder, one of its
// additional folders, or the app's own attachment store.

// Cached for a second (image perf, 2026-10): opening a big Image canvas requests hundreds of
// wbfile:// URLs at once, and each one ran these three queries. A folder you just connected
// removed is refused within a second; one just connected is found at once (a miss re-reads).
let cached: { at: number; roots: string[] } | null = null
function projectRoots(fresh = false): string[] {
  if (!fresh && cached && Date.now() - cached.at < 1000) return cached.roots
  cached = { at: Date.now(), roots: readRoots() }
  return cached.roots
}
function readRoots(): string[] {
  const db = getDb()
  const primary = (db.prepare('SELECT folder_path AS p FROM projects WHERE folder_path IS NOT NULL').all() as { p: string }[]).map((r) => r.p)
  const extra = (db.prepare('SELECT path AS p FROM project_folders').all() as { p: string }[]).map((r) => r.p)
  // The global Image folder (D-088) is a root too: its canvas, inputs and outputs are
  // served over wbfile:// and opened by the same file/reveal/copy handlers.
  const image = (db.prepare('SELECT value AS p FROM settings WHERE key = ?').get(IMAGE_FOLDER_SETTING) as { p: string } | undefined)?.p?.trim()
  return [...new Set([...primary, ...extra, ...(image ? [image] : [])])]
}

const attachmentsRoot = (): string => join(app.getPath('userData'), 'attachments')

// A root the renderer passed for a file operation. Must equal (or lie under) a known
// project folder. Throws otherwise — the IPC caller sees a rejected promise.
export function assertProjectRoot(root: unknown): string {
  const r = expectString(root, 'root')
  const hit = matchRoot(r, projectRoots()) ?? matchRoot(r, projectRoots(true))
  if (!hit) throw new Error('Folder is not connected to any project')
  return r
}

// An absolute path the renderer passed directly (attachment store files). Must lie
// under the app's attachment store or a known project folder.
export function assertKnownAbsolute(abs: unknown): string {
  const a = expectString(abs, 'path')
  if (!matchRoot(a, [attachmentsRoot(), ...projectRoots()]) && !matchRoot(a, projectRoots(true))) throw new Error('Path is outside the app\'s folders')
  return a
}
