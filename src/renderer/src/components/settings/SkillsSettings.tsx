import { useEffect, useState } from 'react'
import SkillsView from '../SkillsView'
import { api } from '../../api'
import type { Project } from '../../../../shared/types'

// Settings ▸ Skills: the Skills list and editor, moved here from the sidebar (Hien, 2026-11-04).
// Changes save as you make them, like the Image folder — the modal's Save isn't needed.
export default function SkillsSettings() {
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => { api.projects.list().then(setProjects).catch(() => setProjects([])) }, [])
  return <div className="settings-skills"><SkillsView projects={projects} /></div>
}
