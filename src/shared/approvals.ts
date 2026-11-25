// Approvals you gave (D-151 D): kept so an approved card stays as a record ("Approved by you · when").
// Stored in one setting — no schema change; the newest 200 are kept.
export const SCHEDULE_APPROVALS_SETTING = 'schedule_approvals'
export interface ApprovalRecord { at: number; kind: 'new' | 'edit' }

export function parseApprovals(raw: string | null | undefined): Record<string, ApprovalRecord> {
  try {
    const j = JSON.parse(raw ?? '{}')
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
    const out: Record<string, ApprovalRecord> = {}
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const r = v as Partial<ApprovalRecord>
      if (r && typeof r.at === 'number' && (r.kind === 'new' || r.kind === 'edit')) out[k] = { at: r.at, kind: r.kind }
    }
    return out
  } catch { return {} }
}

export function recordApproval(raw: string | null | undefined, id: string, kind: ApprovalRecord['kind'], at: number): string {
  const all = { ...parseApprovals(raw), [id]: { at, kind } }
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 200)
  return JSON.stringify(Object.fromEntries(kept))
}
