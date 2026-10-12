// Temp folders the app creates, removed when done, plus a startup sweep of leftovers
// from older versions or crashes (audit #10). Only our own prefixes are touched.
import { readdirSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { staleTempDirs } from './limits'

export function removeTempDir(dir: string | null | undefined): void {
  if (!dir || !dir.startsWith(tmpdir())) return
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
}

// Electron-free on purpose (fsService imports this and is unit-tested). Returns how many were removed.
export function sweepStaleTempDirs(): number {
  try {
    const base = tmpdir()
    const entries = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && (d.name.startsWith('workbench-ctx-') || d.name.startsWith('wb-pdf-')))
      .map((d) => { let mtimeMs = Date.now(); try { mtimeMs = statSync(join(base, d.name)).mtimeMs } catch { /* keep */ } return { name: d.name, mtimeMs, isDir: true } })
    const stale = staleTempDirs(entries, Date.now())
    for (const name of stale) removeTempDir(join(base, name))
    return stale.length
  } catch { return 0 }
}
