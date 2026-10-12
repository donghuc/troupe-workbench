import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, copyFileSync, existsSync } from 'fs'
import { runMigrations } from './migrations'
import { logInfo, logError } from '../util/logger'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData') // ~/Library/Application Support/AI Workbench
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'workbench.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // D-091: with WAL, NORMAL is crash-safe for the app (a power cut can lose the last
  // commit, never corrupt the file) and much cheaper per insert. busy_timeout covers a
  // second handle (backup, external reader) holding a lock briefly.
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 3000')
  const before = db.pragma('user_version', { simple: true }) as number
  try {
    if (before > 0 && existsSync(file)) {
      // Fold the WAL into the main file first (D-100): after a crash or force-quit, recent
      // commits live only in workbench.db-wal, and copying the main file alone would leave
      // them out of the backup — which is the only way back once a one-way migration runs.
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* copy what we have */ }
      try { copyFileSync(file, join(dir, `workbench.pre-v${before}.bak`)) } catch { /* best-effort backup */ }
    }
    runMigrations(db)
    const after = db.pragma('user_version', { simple: true }) as number
    if (after !== before) logInfo(`DB migrated ${before} -> ${after}`)
  } catch (e) {
    logError('DB migration failed', String(e))
    throw e
  }
  return db
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
