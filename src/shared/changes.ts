// Changes made during a chat turn (D-151): what the turn's restore points say changed, how a
// reply stores it, and how the renderer reads a file's diff. Pure — main and renderer share it.

/** Projects with more files than this (after .gitignore) get no restore points. */
export const snapshotFileLimit = 20_000
/** At most this many files are listed on a card; the rest are counted. */
export const CHANGES_LIST_MAX = 200

export interface ChangedFile { path: string; status: 'A' | 'M' | 'D'; add?: number; del?: number; binary?: boolean }
/** Saved on the turn's last reply as metadata.changes. */
export interface TurnChanges {
  before: string                 // snapshot id before the turn
  after: string                  // snapshot id after it
  files: ChangedFile[]
  more?: number                  // files beyond CHANGES_LIST_MAX
  overlap?: boolean              // another chat ran in the same project during this turn
  restored?: { at: number; safety: string; failed?: string[] }   // Restore ran; `safety` = snapshot taken just before it
}
/** Why a turn has no restore point (metadata.changesOff) — shown once, quietly. */
export type ChangesOff = 'no-git' | 'too-big' | 'failed'

export function parseNameStatus(z: string): { path: string; status: 'A' | 'M' | 'D' }[] {
  const parts = z.split('\0'); const out: { path: string; status: 'A' | 'M' | 'D' }[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const s = parts[i].trim()[0]; const path = parts[i + 1]
    if (!path) continue
    out.push({ path, status: s === 'A' ? 'A' : s === 'D' ? 'D' : 'M' })
  }
  return out
}

export function parseNumstat(z: string): Map<string, { add?: number; del?: number; binary?: boolean }> {
  const out = new Map<string, { add?: number; del?: number; binary?: boolean }>()
  for (const rec of z.split('\0')) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(rec.replace(/^\n/, ''))
    if (!m) continue
    out.set(m[3], m[1] === '-' ? { binary: true } : { add: Number(m[1]), del: Number(m[2]) })
  }
  return out
}

export function mergeChanges(names: { path: string; status: 'A' | 'M' | 'D' }[], nums: Map<string, { add?: number; del?: number; binary?: boolean }>): ChangedFile[] {
  return names.map((n) => ({ ...n, ...(nums.get(n.path) ?? {}) })).sort((a, b) => a.path.localeCompare(b.path))
}

export function changesOf(meta: Record<string, unknown> | null | undefined): TurnChanges | null {
  const c = meta?.changes as TurnChanges | undefined
  return c && typeof c.before === 'string' && typeof c.after === 'string' && Array.isArray(c.files) ? c : null
}

/** Total lines added / removed on a card. */
export function totals(files: ChangedFile[]): { add: number; del: number } {
  return files.reduce((t, f) => ({ add: t.add + (f.add ?? 0), del: t.del + (f.del ?? 0) }), { add: 0, del: 0 })
}

/** Files this reply changed that a LATER reply also changed — restoring takes those changes too. */
export function laterOverlap(metas: (Record<string, unknown> | null | undefined)[], index: number): { path: string; at: number }[] {
  const mine = changesOf(metas[index]); if (!mine) return []
  const paths = new Set(mine.files.map((f) => f.path))
  const out: { path: string; at: number }[] = []
  metas.slice(index + 1).forEach((m, i) => {
    const c = changesOf(m); if (!c || c.restored) return
    for (const f of c.files) if (paths.has(f.path) && !out.some((o) => o.path === f.path)) out.push({ path: f.path, at: index + 1 + i })
  })
  return out
}

export interface DiffLine { kind: 'hunk' | 'ctx' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }
/** A unified diff as display lines (file headers dropped). */
export function parseUnifiedDiff(diff: string, max = 2000): { lines: DiffLine[]; binary: boolean; truncated: boolean } {
  if (/^Binary files /m.test(diff)) return { lines: [], binary: true, truncated: false }
  const lines: DiffLine[] = []; let o = 0, n = 0, started = false
  for (const raw of diff.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (h) { o = Number(h[1]); n = Number(h[2]); started = true; lines.push({ kind: 'hunk', text: h[3].trim() }); continue }
    if (!started || raw.startsWith('\\')) continue
    if (raw.startsWith('+')) lines.push({ kind: 'add', text: raw.slice(1), newNo: n++ })
    else if (raw.startsWith('-')) lines.push({ kind: 'del', text: raw.slice(1), oldNo: o++ })
    else if (raw.startsWith(' ')) lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: o++, newNo: n++ })
    if (lines.length >= max) return { lines, binary: false, truncated: true }
  }
  return { lines, binary: false, truncated: false }
}

// Only new files, all listed (at most 5): nothing to diff or restore, so no Changes card — the
// files show as file cards under the reply instead (B-078). A longer or cut list keeps the card.
export const createdOnly = (c: TurnChanges): boolean =>
  !c.restored && !c.more && c.files.length > 0 && c.files.length <= 5 && c.files.every((f) => f.status === 'A')
