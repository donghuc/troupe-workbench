import { handle } from './handle'
import { readMemoryFile, writeMemory, readGlobalMemory, writeGlobalMemory, memoryOverview, adoptAgentsFile } from '../context/projectMemory'
import { assertProjectRoot } from '../security/roots'

export function registerMemoryIpc(): void {
  handle('projectMemory.read', (_e, folderPath: string) => readMemoryFile(assertProjectRoot(folderPath)))
  handle('projectMemory.write', (_e, folderPath: string, text: string) => writeMemory(assertProjectRoot(folderPath), typeof text === 'string' ? text : ''))
  handle('projectMemory.globalRead', () => readGlobalMemory())
  handle('projectMemory.globalWrite', (_e, text: string) => writeGlobalMemory(text))
  handle('projectMemory.overview', () => memoryOverview())
  handle('projectMemory.adopt', (_e, folderPath: string | null) => adoptAgentsFile(folderPath == null ? null : assertProjectRoot(folderPath)))
}
