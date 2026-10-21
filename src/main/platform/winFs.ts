// Windows file-lock retries (D-120). Windows refuses to replace or rename a file another
// process has open (an agent, an editor, antivirus scanning a new file): EPERM / EBUSY /
// EACCES for a moment. A few short retries ride that out. macOS: one plain attempt.
import { renameSync, existsSync, promises as fsp } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
const TRIES = 6
const isWin = process.platform === 'win32'

function sleepSync(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

export function renameSyncRetry(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return } catch (e) {
      if (!isWin || i >= TRIES - 1 || !BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e
      sleepSync(50 * (i + 1))
    }
  }
}

export async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try { await fsp.rename(from, to); return } catch (e) {
      if (!isWin || i >= TRIES - 1 || !BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }
}

// `.workbench` (attachments, Collab bookkeeping) is hidden on the Mac by its leading dot;
// Explorer shows dot-folders, so on Windows it gets the Hidden attribute (D-130). Once per
// project per session; failures are ignored (a read-only or network folder just stays visible).
const hidden = new Set<string>()
export function hideWorkbenchDir(root: string | null | undefined): void {
  if (!isWin || !root || hidden.has(root)) return
  const dir = join(root, '.workbench')
  if (!existsSync(dir)) return
  hidden.add(root)
  execFile('attrib', ['+h', dir], { windowsHide: true }, () => { /* best effort */ })
}
