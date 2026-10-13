import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'
import { getDb } from '../database/db'
import { getProject } from '../projects/projectsRepo'
import { ensureInside } from '../filesystem/fsService'
import { parseDecisions, appendOutcome, nextOutcomeId, isTroupeDecisionsLog, DECISIONS_FILE, LEGACY_DECISIONS_FILE, type Outcome } from '../../shared/decisions'
import type { Project } from '../../shared/types'
import { logInfo, logError } from '../util/logger'

// The decisions log per project (D-081 step 5): <folder>/DECISIONS.md when the project
// has a folder (visible, editable, readable by agents), else the projects.decisions
// column. Read on every turn (small file), written only by Save outcome.

// D-103: the log moved from DECISIONS.md to TROUPE-DECISIONS.md. On first use, a DECISIONS.md
// that Troupe wrote is renamed; a user's own DECISIONS.md (not in Troupe's format) is left alone.
function fileFor(p: Project): string | null {
  if (!p.folderPath) return null
  const f = ensureInside(p.folderPath, DECISIONS_FILE)
  if (existsSync(f)) return f
  const legacy = ensureInside(p.folderPath, LEGACY_DECISIONS_FILE)
  try {
    if (existsSync(legacy) && isTroupeDecisionsLog(readFileSync(legacy, 'utf8'))) {
      renameSync(legacy, f)
      logInfo('decisions log renamed', { project: p.id, from: LEGACY_DECISIONS_FILE, to: DECISIONS_FILE })
    }
  } catch (e) { logError('decisions log rename failed', String(e)) }
  return f
}

function readDecisionsText(p: Project): string {
  const f = fileFor(p)
  if (f) { try { return existsSync(f) ? readFileSync(f, 'utf8') : '' } catch { return '' } }
  const row = getDb().prepare('SELECT decisions FROM projects WHERE id = ?').get(p.id) as { decisions?: string } | undefined
  return row?.decisions ?? ''
}

export const listOutcomes = (p: Project): Outcome[] => parseDecisions(readDecisionsText(p))

export function saveOutcome(projectId: string, draft: Omit<Outcome, 'id' | 'date'> & { id?: string; date: string }): Outcome {
  const p = getProject(projectId)
  if (!p) throw new Error('Project not found')
  const existing = listOutcomes(p)
  const o: Outcome = { ...draft, id: draft.id || nextOutcomeId(existing) }
  delete (o as Partial<Outcome>).conflicts   // a draft-time note, not part of the record
  const next = appendOutcome(readDecisionsText(p), o, p.name)
  const f = fileFor(p)
  if (f) writeFileSync(f, next, 'utf8')
  else getDb().prepare('UPDATE projects SET decisions = ? WHERE id = ?').run(next, p.id)
  logInfo('outcome saved', { project: p.id, id: o.id, kind: o.kind, where: f ? DECISIONS_FILE : 'db' })
  return o
}
