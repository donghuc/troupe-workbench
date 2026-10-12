import { handle } from './handle'
import { listSkills, createSkill, updateSkill, deleteSkill, draftSkill, resetBuiltinSkill } from '../skills/skillsFs'
import type { SkillInput, SkillScope } from '../../shared/types'

export function registerSkillIpc(): void {
  handle('skills.list', (_e, cwd?: string) => listSkills(cwd))
  handle('skills.create', (_e, input: SkillInput, cwd?: string) => createSkill(input, cwd))
  handle('skills.update', (_e, id: string, patch: Partial<SkillInput>, cwd?: string) => updateSkill(id, patch, cwd))
  handle('skills.remove', (_e, id: string, cwd?: string) => deleteSkill(id, cwd))
  handle('skills.reset', (_e, id: string) => resetBuiltinSkill(id))
  handle('skills.draft', (_e, purpose: string, scope: SkillScope, cwd?: string) => draftSkill(purpose, scope, cwd))
}
