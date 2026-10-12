import chokidar, { FSWatcher } from 'chokidar'
import { relative, sep, resolve } from 'path'
import type { WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import type { FileChange } from '../../shared/types'
import { isWatchIgnored } from './treeLimits'

// One watcher per window; re-pointing swaps the root.
let watcher: FSWatcher | null = null
let watchedRoot: string | null = null

export function startWatch(root: string, sender: WebContents): void {
  if (watchedRoot === resolve(root) && watcher) return
  stopWatch()
  const rootAbs = resolve(root)
  watchedRoot = rootAbs
  watcher = chokidar.watch(rootAbs, {
    ignored: (p) => isWatchIgnored(rootAbs, p),   // D-091: same heavy folders the tree skips
    ignoreInitial: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 }
  })
  const emit = (event: FileChange['event']) => (abs: string) => {
    if (sender.isDestroyed()) return
    const relPath = relative(rootAbs, abs).split(sep).join('/')
    const change: FileChange = { event, relPath }
    sender.send(IPC.filesChanged, change)
  }
  watcher
    .on('add', emit('add'))
    .on('change', emit('change'))
    .on('unlink', emit('unlink'))
    .on('addDir', emit('addDir'))
    .on('unlinkDir', emit('unlinkDir'))
}

export function stopWatch(): void {
  if (watcher) { watcher.close(); watcher = null }
  watchedRoot = null
}
