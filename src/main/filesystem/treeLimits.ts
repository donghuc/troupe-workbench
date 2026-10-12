// Bounds for walking a project folder (D-068 / audit #12). A connected folder can hold
// build output, Xcode bundles or a whole Dropbox; walking all of it froze the file
// browser. Heavy folders are listed but not opened; depth and total entries are capped.
// Anything not walked is marked `truncated` and can be loaded on demand. Pure.

export const TREE_MAX_DEPTH = 8
export const TREE_MAX_ENTRIES = 10_000

// Generated / dependency folders: shown, but their contents are not walked.
const HEAVY_NAMES = new Set([
  'node_modules', 'DerivedData', 'Pods', 'Carthage', 'build', 'dist', 'out', 'target',
  '__pycache__', 'venv', 'env', 'site-packages', 'bower_components', 'vendor', 'xcuserdata', 'Library'
])
// macOS bundles and Xcode containers are directories on disk but one "thing" to a person.
const HEAVY_EXT = /\.(xcodeproj|xcworkspace|xcassets|xcframework|framework|app|bundle|photoslibrary|musiclibrary|sketch|fcpbundle|lproj)$/i

export type SkipReason = 'heavy' | 'depth' | 'limit'

/** Why a directory's contents should not be walked now, or null to walk it. */
export function dirSkipReason(name: string, depth: number, entriesSoFar: number): SkipReason | null {
  if (HEAVY_NAMES.has(name) || HEAVY_EXT.test(name)) return 'heavy'
  if (depth >= TREE_MAX_DEPTH) return 'depth'
  if (entriesSoFar >= TREE_MAX_ENTRIES) return 'limit'
  return null
}

// D-091: the folder watcher skips what the tree never opens, plus app/VCS folders.
// Judged on the path *relative to the watched root* — a project can itself live under
// ~/Library (Dropbox, iCloud), and that must not hide the whole project.
const WATCH_SKIP = new Set(['.git', '.workbench', '.DS_Store'])
export function isWatchIgnored(rootAbs: string, abs: string): boolean {
  const r = rootAbs.replace(/[\\/]+$/, '')
  if (!abs.startsWith(r + '/') && !abs.startsWith(r + '\\')) return false
  const segs = abs.slice(r.length + 1).split(/[\\/]/)
  // VCS/app folders are skipped entirely; a heavy folder itself is still watched (so it
  // appearing or vanishing refreshes the tree) but nothing inside it is (D-100).
  if (segs.some((seg) => WATCH_SKIP.has(seg))) return true
  return segs.slice(0, -1).some((seg) => HEAVY_NAMES.has(seg) || HEAVY_EXT.test(seg))
}
