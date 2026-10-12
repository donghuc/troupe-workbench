import { resolve, sep } from 'path'

// Pure path checks for the IPC boundary (D-060 item 6). `ensureInside(root, rel)` only
// proves `rel` stays under `root`; these decide whether `root` itself is one the app
// may touch. No Electron, no DB here — see roots.ts for the DB-backed list.

// True when `abs` is `dir` itself or lies strictly under it (after resolving both).
export function isUnder(abs: string, dir: string): boolean {
  const a = resolve(abs)
  const d = resolve(dir)
  return a === d || a.startsWith(d.endsWith(sep) ? d : d + sep)
}

// The matching allowed directory for `abs`, or null when it is under none of them.
export function matchRoot(abs: string, allowed: readonly string[]): string | null {
  for (const d of allowed) if (d && isUnder(abs, d)) return resolve(d)
  return null
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
