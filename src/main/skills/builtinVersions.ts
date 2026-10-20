// Fingerprints of built-in skill files as previously shipped (D-064). On startup a
// seeded SKILL.md whose content matches one of these exactly was never edited by the
// user, so it is safe to replace with the current canonical version. When you change
// a built-in's body, name, description or triggers, ADD the old version's hash here
// (compute with contentHash on the old serialized file) — never remove entries.
import { createHash } from 'crypto'

export const contentHash = (s: string): string =>
  createHash('sha256').update(s.replace(/\r\n/g, '\n').trim()).digest('hex')

const PREVIOUS_VERSIONS = new Set<string>([
  // 1.0.x – 1.3.0 (git fc81941 … v1.3.0)
  'b0eaee6fca926b76e195cbfafd914a6c8c6c9efcd478c9e40b247bed5afa4620', // explain-this
  'a691413215e2b17a9978890b64741f98be547a8b3907a588734fe86bad4cac74', // collab-protocol
  '00f42ea0af4c18db99a70c8ef958e5245a6c0847b66f9a26be4d33c9693d89d5', // role-planner
  '562bc6ed31963bb25c1ddeb47c5125a7d2681ae0ebda66c4ee63e6742ad7c2b2', // role-maker
  '10d7ce7e44f08fc4f733ee56634461f1129926515391770681c706d3fb00610e', // role-reviewer
  // up to 2.9.0
  '20394913a0a703f738562865d8f3f1b192688d6c6d9df13da5e5347bf08a112f', // role-planner (D-121: three jobs, reviewer choice)
  '884c140e98dddedb46e6d6f97cd52cc492c2578451ae3dccb27e1695e4b04927', // role-reviewer (D-121: read-only commands for shell agents; BLOCKED)
  // up to 2.11.0 (2.11.1: Troupe writes PLAN.md and STATUS.md; agents report in their reply)
  '538abf503c4778df2e60e36aabba5a2d6c804f1a0e46691d9a179e15fdb1307b', // collab-protocol
  '6eb78dca78a920774234ba76913058610bfb709a61978e32bb75605e22f90355', // role-planner
  '14ec623bcff6fa509740bd01d6147a5d44f76ac183440302b8e45f3a7089cb4f'  // role-maker
])

/** True when `current` is an untouched earlier shipped version and differs from `canonical`. */
export function isUneditedOldBuiltin(current: string, canonical: string): boolean {
  const h = contentHash(current)
  return h !== contentHash(canonical) && PREVIOUS_VERSIONS.has(h)
}
