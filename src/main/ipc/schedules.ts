import { handle } from './handle'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, getSchedule } from '../schedules/schedulesRepo'
import { runScheduleNow } from '../schedules/scheduler'
import type { NewScheduleInput, SchedulePatch } from '../../shared/types'

export function registerScheduleIpc(): void {
  handle('schedules.list', () => listSchedules())
  handle('schedules.create', (_e, input: NewScheduleInput) => createSchedule(input))
  handle('schedules.update', (_e, id: string, patch: SchedulePatch) => updateSchedule(id, patch))
  handle('schedules.remove', (_e, id: string) => deleteSchedule(id))
  handle('schedules.runNow', (_e, id: string) => { const s = getSchedule(id); if (s) runScheduleNow(s) })
}
