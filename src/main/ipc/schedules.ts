import { handle } from './handle'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, getSchedule, setBotManaged } from '../schedules/schedulesRepo'
import { reviewSchedule } from '../schedules/scheduleChanges'
import { runScheduleNow } from '../schedules/scheduler'
import type { NewScheduleInput, SchedulePatch } from '../../shared/types'

export function registerScheduleIpc(): void {
  handle('schedules.list', () => listSchedules())
  // Tasks made in the app: yours, on, not handed over (D-134).
  handle('schedules.create', (_e, input: NewScheduleInput) => createSchedule({ ...input, createdVia: 'app', botManaged: false, enabled: true, pending: null }))
  handle('schedules.update', (_e, id: string, patch: SchedulePatch) => updateSchedule(id, patch))
  handle('schedules.remove', (_e, id: string) => deleteSchedule(id))
  handle('schedules.runNow', (_e, id: string) => { const s = getSchedule(id); if (s) runScheduleNow(s) })
  handle('schedules.setBotManaged', (_e, id: string, on: boolean) => { setBotManaged(id, !!on); return getSchedule(id) })
  handle('schedules.review', (_e, id: string, approve: boolean) => reviewSchedule(id, !!approve))
}
