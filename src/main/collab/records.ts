// What changed while a Maker worked (D-128) — Troupe's own record for the Reviewer and the
// wrap-up (audit #12: split out of orchestrator.ts).
import { join } from 'path'
import type { CollabRun, CollabTask } from '../../shared/types'
import { getTask, updateTask } from './collabRepo'
import { snapshot, diffSnapshots, type Snapshot } from './projectSnapshot'
import { makerProviderOf, providerLabelOf, replyFiles } from './agents'

// D-128: the project as it was when each task's current Maker attempt started (in memory only;
// after a restart the record says the change list is unknown).
export const makerSnaps = new Map<string, Snapshot | null>()
/** A run that ended keeps no snapshots (audit #9). */

export const forgetSnaps = (run: CollabRun): void => { for (const t of run.tasks ?? []) makerSnaps.delete(t.id) }

export function recordAttempt(run: CollabRun, task: CollabTask): void {
  const before = makerSnaps.get(task.id)
  makerSnaps.delete(task.id)   // audit #9: the map kept every task's snapshot for the life of the app
  const after = before ? snapshot(run.projectCwd) : null
  const d = before && after ? diffSnapshots(before, after) : { added: [], changed: [], removed: [] }
  const maker = makerProviderOf(run, task)
  updateTask(task.id, { meta: { ...(getTask(task.id)?.meta ?? task.meta), recorded: { by: maker, savedByTroupe: replyFiles(run, maker), ...d, complete: !!(before && after) } } })
}

const fileList = (fs: string[], max = 15): string => fs.length ? fs.slice(0, max).map((f) => `\`${f}\``).join(', ') + (fs.length > max ? ` and ${fs.length - max} more` : '') : 'none'
/** The record as facts for a Reviewer or the wrap-up. */

export function recordText(t: CollabTask): string {
  const r = t.meta.recorded
  if (!r) return ''
  const who = `${providerLabelOf(r.by)}${r.savedByTroupe ? ' (its files were saved by Troupe from its reply)' : ''}`
  if (!r.complete) return `- Made by ${who}. Troupe couldn't list every file that changed (the project is too large to compare).`
  const parts = [r.added.length ? `added ${fileList(r.added)}` : '', r.changed.length ? `changed ${fileList(r.changed)}` : '', r.removed.length ? `removed ${fileList(r.removed)}` : ''].filter(Boolean)
  return `- Made by ${who}. While it worked, the project ${parts.length ? parts.join('; ') : 'had no file changes'} — nothing else changed (build, dependency and .workbench folders aren't compared).`
}
