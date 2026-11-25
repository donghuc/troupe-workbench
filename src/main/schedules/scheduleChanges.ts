// Applying scheduled-task changes that came from a bot, and your Approve / Discard in Tasks
// (D-134). The rules themselves are pure, in shared/scheduleRules.ts.
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { reviewAction } from '../../shared/scheduleRules'
import { getSchedule, updateSchedule, deleteSchedule, setPending } from './schedulesRepo'
import { logInfo } from '../util/logger'
import { getSetting, setSetting } from '../database/settingsRepo'
import { SCHEDULE_APPROVALS_SETTING, recordApproval } from '../../shared/approvals'
import type { Schedule } from '../../shared/types'

/** Tasks changed outside the Tasks view (a bot, the scheduler): the window reloads its list. */
export function broadcastSchedulesChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.schedulesChanged)
}

/** Approve or Discard a bot's waiting change. Returns the task, or null when it was deleted. */
export function reviewSchedule(id: string, approve: boolean): Schedule | null {
  const s = getSchedule(id)
  if (!s?.pending) return s
  const a = reviewAction(s.pending, approve)
  logInfo('[schedules] review', { task: id, kind: s.pending.kind, approve })
  if (a.op === 'delete') { deleteSchedule(id); broadcastSchedulesChanged(); return null }
  setPending(id, null)
  if (approve && s.pending.kind !== 'delete') setSetting(SCHEDULE_APPROVALS_SETTING, recordApproval(getSetting(SCHEDULE_APPROVALS_SETTING), id, s.pending.kind, Date.now()))   // D-151: the card's record
  const out = a.op === 'enable' ? updateSchedule(id, { enabled: true })
    : a.op === 'update' ? updateSchedule(id, a.patch)
    : updateSchedule(id, { enabled: a.enabled })
  broadcastSchedulesChanged()
  return out
}
