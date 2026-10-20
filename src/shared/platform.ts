// Which OS the app runs on, for code shared by main and the window (Windows port, D-120).
// Main and tests read process.platform; the sandboxed window has no `process` and reads the
// value the preload bridge exposes (window.workbench.platform).
function detect(): string {
  try { if (typeof process !== 'undefined' && process.platform) return process.platform } catch { /* window */ }
  const w = (globalThis as { workbench?: { platform?: string } }).workbench
  return w?.platform ?? 'darwin'
}

const PLATFORM = detect()
export const IS_WINDOWS = PLATFORM === 'win32'

/** Words that differ by OS, for UI text. */
export const OS_WORDS = IS_WINDOWS
  ? { computer: 'PC', terminal: 'PowerShell', fileManager: 'File Explorer', showInFolder: 'Show in File Explorer', mod: 'Ctrl+', shift: 'Shift+', alt: 'Alt+' }
  : { computer: 'Mac', terminal: 'Terminal', fileManager: 'Finder', showInFolder: 'Show in Finder', mod: '⌘', shift: '⇧', alt: '⌥' }

/** Last segment of a file path. Windows paths may use either separator; macOS splits on `/` only, as before. */
export function fileBase(p: string): string {
  return (IS_WINDOWS ? p.split(/[\\/]/) : p.split('/')).pop() ?? ''
}

/** An absolute file path: `/…`, or on Windows also `C:\…` / `C:/…`. */
export function isAbsPath(p: string): boolean {
  return p.startsWith('/') || (IS_WINDOWS && /^[a-z]:[\\/]/i.test(p))
}

/**
 * `p` relative to `root` when it lies under it, else null. macOS: exact `root + '/'` prefix,
 * as before. Windows: either separator and any case; the result uses `/`.
 */
export function relUnder(p: string, root: string): string | null {
  if (!IS_WINDOWS) return p.startsWith(root + '/') ? p.slice(root.length + 1) : null
  const a = p.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return a.toLowerCase().startsWith(r.toLowerCase() + '/') ? a.slice(r.length + 1) : null
}
