import { getDb } from '../database/db'

export function listContextFiles(projectId: string): string[] {
  return (getDb()
    .prepare('SELECT rel_path FROM project_context WHERE project_id = ? ORDER BY rel_path')
    .all(projectId) as { rel_path: string }[]).map((r) => r.rel_path)
}

export function addContextFile(projectId: string, relPath: string): void {
  getDb().prepare(
    `INSERT INTO project_context (project_id, rel_path, added_at) VALUES (?, ?, ?)
     ON CONFLICT(project_id, rel_path) DO NOTHING`
  ).run(projectId, relPath, Date.now())
}

export function removeContextFile(projectId: string, relPath: string): void {
  getDb().prepare('DELETE FROM project_context WHERE project_id = ? AND rel_path = ?').run(projectId, relPath)
}
