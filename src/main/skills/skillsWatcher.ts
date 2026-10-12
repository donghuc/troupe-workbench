import chokidar, { FSWatcher } from 'chokidar'
import { homedir } from 'os'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { listProjects } from '../projects/projectsRepo'

// Watch every skills directory (global + each project's) so skills authored by an
// agent or edited in an external editor show up live (D-018 / agent-authored polish).
let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

function skillDirs(): string[] {
  const dirs = [join(homedir(), '.claude', 'skills')]
  for (const p of listProjects()) if (p.folderPath) dirs.push(join(p.folderPath, '.claude', 'skills'))
  return dirs
}

function ping(): void {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.skillsChanged)
  }, 200)
}

// (Re)point the watcher at the current set of skills dirs. Call at startup and
// whenever the project list changes.
export function refreshSkillsWatch(): void {
  try {
    if (watcher) { watcher.close(); watcher = null }
    watcher = chokidar.watch(skillDirs(), { ignoreInitial: true, depth: 3, awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 60 } })
    watcher.on('add', ping).on('change', ping).on('unlink', ping).on('addDir', ping).on('unlinkDir', ping)
  } catch { /* non-fatal */ }
}

export function stopSkillsWatch(): void { if (watcher) { watcher.close(); watcher = null } }
