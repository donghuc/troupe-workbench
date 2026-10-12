import { randomUUID } from 'crypto'
import { getDb } from '../database/db'
import type { Project, NewProjectInput, ProjectPatch } from '../../shared/types'

interface Row {
  id: string
  name: string
  description: string
  instructions: string
  memory: string
  folder_path: string | null
  created_at: number
  last_opened_at: number
  sort_order: number
}

const toProject = (r: Row, extraFolders: string[] = []): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  instructions: r.instructions,
  memory: r.memory,
  folderPath: r.folder_path,
  extraFolders,
  createdAt: r.created_at,
  lastOpenedAt: r.last_opened_at,
  sortOrder: r.sort_order
})

// Additional folders only (the primary is `projects.folder_path`, D-054), oldest first.
function listExtraFolders(projectId: string): string[] {
  const rows = getDb()
    .prepare('SELECT path FROM project_folders WHERE project_id = ? AND is_primary = 0 ORDER BY added_at ASC')
    .all(projectId) as Array<{ path: string }>
  return rows.map((r) => r.path)
}

// One query for the whole list — listProjects runs on every refresh.
function extraFoldersByProject(): Map<string, string[]> {
  const rows = getDb()
    .prepare('SELECT project_id, path FROM project_folders WHERE is_primary = 0 ORDER BY added_at ASC')
    .all() as Array<{ project_id: string; path: string }>
  const map = new Map<string, string[]>()
  for (const r of rows) {
    const list = map.get(r.project_id)
    if (list) list.push(r.path)
    else map.set(r.project_id, [r.path])
  }
  return map
}

// `projects.folder_path` stays the source of truth for the primary folder; this keeps
// the `project_folders` mirror of it honest whenever it changes (D-054).
function syncPrimaryFolder(projectId: string, folderPath: string | null): void {
  const db = getDb()
  db.prepare('DELETE FROM project_folders WHERE project_id = ? AND is_primary = 1').run(projectId)
  if (!folderPath) return
  // A folder cannot be both primary and additional.
  db.prepare('DELETE FROM project_folders WHERE project_id = ? AND path = ?').run(projectId, folderPath)
  db.prepare('INSERT INTO project_folders (project_id, path, is_primary, added_at) VALUES (?, ?, 1, ?)')
    .run(projectId, folderPath, Date.now())
}

// Recent first.
export function listProjects(): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY sort_order ASC, created_at DESC')
    .all() as Row[]
  const extras = extraFoldersByProject()
  return rows.map((r) => toProject(r, extras.get(r.id) ?? []))
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  return row ? toProject(row, listExtraFolders(id)) : null
}

export function createProject(input: NewProjectInput): Project {
  const now = Date.now()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, description, instructions, folder_path, created_at, last_opened_at, sort_order)
       VALUES (@id, @name, @description, '', NULL, @now, @now, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM projects))`
    )
    .run({ id, name: input.name.trim(), description: (input.description ?? '').trim(), now })
  return getProject(id)!
}

// Persist a manual project order: sort_order = position in the given id list.
export function reorderProjects(orderedIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?')
  const tx = db.transaction((ids: string[]) => { ids.forEach((id, i) => stmt.run(i, id)) })
  tx(orderedIds)
}

export function updateProject(id: string, patch: ProjectPatch): Project {
  const fields: string[] = []
  const params: Record<string, unknown> = { id }
  if (patch.name !== undefined) { fields.push('name = @name'); params.name = patch.name.trim() }
  if (patch.description !== undefined) { fields.push('description = @description'); params.description = patch.description }
  if (patch.instructions !== undefined) { fields.push('instructions = @instructions'); params.instructions = patch.instructions }
  if (patch.memory !== undefined) { fields.push('memory = @memory'); params.memory = patch.memory }
  if (patch.folderPath !== undefined) { fields.push('folder_path = @folderPath'); params.folderPath = patch.folderPath }
  if (fields.length) {
    getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = @id`).run(params)
  }
  if (patch.folderPath !== undefined) syncPrimaryFolder(id, patch.folderPath)
  return getProject(id)!
}

// Add an additional folder. Idempotent, and never shadows the primary folder.
export function addProjectFolder(id: string, path: string): Project {
  const p = path.trim()
  const project = getProject(id)
  if (p && project && p !== project.folderPath) {
    getDb()
      .prepare('INSERT OR IGNORE INTO project_folders (project_id, path, is_primary, added_at) VALUES (?, ?, 0, ?)')
      .run(id, p, Date.now())
  }
  return getProject(id)!
}

export function removeProjectFolder(id: string, path: string): Project {
  getDb()
    .prepare('DELETE FROM project_folders WHERE project_id = ? AND path = ? AND is_primary = 0')
    .run(id, path)
  return getProject(id)!
}

export function touchProject(id: string): void {
  getDb().prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(Date.now(), id)
}

export function deleteProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}
