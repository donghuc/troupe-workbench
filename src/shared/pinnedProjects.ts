// Pinned projects (sidebar section above Projects). Kept as a setting — a list of project ids in
// the order you pinned them — so pinning needs no database change.
export const PINNED_PROJECTS_SETTING = 'pinned_projects'

export function parsePinned(raw: string | null | undefined): string[] {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [] } catch { return [] }
}
