import { resolve, sep } from 'path'

// Pure path checks for the IPC boundary (D-060 item 6). `ensureInside(root, rel)` only
// proves `rel` stays under `root`; these decide whether `root` itself is one the app
// may touch. No Electron, no DB here — see roots.ts for the DB-backed list.

// True when resolved path `a` is `d` itself or lies strictly under it. Windows paths are
// case-insensitive (D-120), so there both sides are compared lower-cased; macOS compares
// exactly, as before.
export function underResolved(a: string, d: string, win = process.platform === 'win32'): boolean {
  if (win) { a = a.toLowerCase(); d = d.toLowerCase() }
  return a === d || a.startsWith(d.endsWith(sep) ? d : d + sep)
}

// True when `abs` is `dir` itself or lies strictly under it (after resolving both).
export function isUnder(abs: string, dir: string): boolean {
  return underResolved(resolve(abs), resolve(dir))
}

// The matching allowed directory for `abs`, or null when it is under none of them.
export function matchRoot(abs: string, allowed: readonly string[]): string | null {
  for (const d of allowed) if (d && isUnder(abs, d)) return resolve(d)
  return null
}

// Links the app may hand to the OS (shell.openExternal). Anything else — smb://, a
// custom app scheme, file:// — could mount a share or drive another app from a page
// the user only previewed (security review 2026-10).
export function isSafeExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim())
}

// One folder name (a skill slug): no separators, not '.' or '..', not empty.
export function isSafeSegment(s: string): boolean {
  return s.length > 0 && s !== '.' && s !== '..' && !/[\\/\0]/.test(s)
}

// Argument-shape helpers: IPC arguments arrive untyped from the renderer.
export function expectString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Invalid ${name}`)
  return v
}
export function expectOptionalString(v: unknown, name: string): string | null {
  if (v === null || v === undefined) return null
  return expectString(v, name)
}
