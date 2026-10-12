import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb } from '../database/db'
import { getProject } from '../projects/projectsRepo'
import { ensureInside } from '../filesystem/fsService'
import { parseDecisions, appendOutcome, nextOutcomeId, DECISIONS_FILE, type Outcome } from '../../shared/decisions'
import type { Project } from '../../shared/types'
import { logInfo } from '../util/logger'

// The decisions log per project (D-081 step 5): <folder>/DECISIONS.md when the project
// has a folder (visible, editable, readable by agents), else the projects.decisions
// column. Read on every turn (small file), written only by Save outcome.

function fileFor(p: Project): string | null { return p.folderPath ? ensureInside(p.folderPath, DECISIONS_FILE) : null }

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
