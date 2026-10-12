import Database from 'better-sqlite3'
import { runMigrations } from '../database/migrations'

// D-091: an in-memory SQLite with every migration applied, for repo tests. Use with
//   vi.mock('../database/db', () => ({ getDb: () => testDb() }))
// better-sqlite3 13 loads an N-API prebuild, so the same binary runs under Node (Vitest)
// and Electron. Never point this at the real workbench.db.
let db: Database.Database | null = null
export function testDb(): Database.Database {
  if (!db) { db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db) }
  return db
}
export function resetTestDb(): Database.Database {
  db?.close(); db = null
  return testDb()
}
export function seedConversation(id = 'c1'): string {
  const d = testDb(); const now = Date.now()
  d.prepare(`INSERT OR IGNORE INTO projects (id, name, created_at, last_opened_at) VALUES ('p1', 'P', ?, ?)`).run(now, now)
  d.prepare(`INSERT INTO conversations (id, project_id, title, provider, created_at, updated_at) VALUES (?, 'p1', 't', 'claude-code', ?, ?)`).run(id, now, now)
  return id
}
