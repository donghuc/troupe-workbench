import { dialog, BrowserWindow } from 'electron'
import { handle } from './handle'
import { refreshSkillsWatch } from '../skills/skillsWatcher'
import type { NewProjectInput, ProjectPatch, ConnectFolderResult, MirrorResult } from '../../shared/types'
import { readMemoryFile, writeMemory } from '../context/projectMemory'
import {
  reorderProjects,
  listProjects, getProject, createProject, updateProject, touchProject, deleteProject,
  addProjectFolder, removeProjectFolder
} from '../projects/projectsRepo'

export function registerProjectIpc(): void {
  handle('projects.list', () => listProjects())
  handle('projects.get', (_e, id: string) => getProject(id))
  handle('projects.create', (_e, input: NewProjectInput) => { const p = createProject(input); refreshSkillsWatch(); return p })
  handle('projects.update', (_e, id: string, patch: ProjectPatch) => { const p = updateProject(id, patch); refreshSkillsWatch(); return p })
  handle('projects.touch', (_e, id: string) => touchProject(id))
  handle('projects.remove', (_e, id: string) => { deleteProject(id); refreshSkillsWatch() })

  // Connecting a folder must move the DB memory blob into the folder's CLAUDE.md —
  // otherwise the UI reads the (absent) file and says "Not set" while the runner
  // still injects the orphaned column (D-055 step 6, B5).
  handle('projects.connectFolder', (_e, id: string, folderPath: string): ConnectFolderResult => {
    const blob = getProject(id)?.memory?.trim() ?? ''
    let memory: ConnectFolderResult['memory'] = 'none'
    let mirror: MirrorResult | undefined
    if (blob) {
      const existing = readMemoryFile(folderPath)?.trim() ?? ''
      mirror = writeMemory(folderPath, existing
        ? [existing, '## Imported from Workbench (pre-folder)', blob].join('\n\n')
        : blob)
      memory = existing ? 'merged' : 'created'
    }
    // Clear the column only once its content is safely in the file.
    const project = updateProject(id, { folderPath, ...(blob ? { memory: '' } : {}) })
    refreshSkillsWatch()
    return { project, memory, mirror }
  })

  // Additional folders (D-054): places the agent may read and edit via `--add-dir`.
  // They are not roots — memory, skills, .mcp.json and the file browser stay primary-only.
  handle('projects.addFolder', (_e, id: string, folderPath: string) => addProjectFolder(id, folderPath))
  handle('projects.removeFolder', (_e, id: string, folderPath: string) => removeProjectFolder(id, folderPath))
  handle('projects.reorder', (_e, orderedIds: string[]) => reorderProjects(orderedIds))

  handle('dialog.selectFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Connect a project folder'
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
}
