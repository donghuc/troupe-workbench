import { handle } from './handle'
import { listSkills, createSkill, updateSkill, deleteSkill, draftSkill, resetBuiltinSkill } from '../skills/skillsFs'
import { assertProjectRoot } from '../security/roots'
import type { SkillInput, SkillScope } from '../../shared/types'

// A project's skills live in <folder>/.claude/skills: the folder must be a connected one.
const C = (cwd?: string): string | undefined => (cwd ? assertProjectRoot(cwd) : undefined)

export function registerSkillIpc(): void {
  handle('skills.list', (_e, cwd?: string) => listSkills(cwd))
  handle('skills.create', (_e, input: SkillInput, cwd?: string) => createSkill(input, C(cwd)))
  handle('skills.update', (_e, id: string, patch: Partial<SkillInput>, cwd?: string) => updateSkill(id, patch, C(cwd)))
  handle('skills.remove', (_e, id: string, cwd?: string) => deleteSkill(id, C(cwd)))
  handle('skills.reset', (_e, id: string) => resetBuiltinSkill(id))
  handle('skills.draft', (_e, purpose: string, scope: SkillScope, cwd?: string) => draftSkill(purpose, scope, C(cwd)))
}
