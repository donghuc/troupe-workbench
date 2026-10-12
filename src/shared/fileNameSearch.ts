// File-name search for Files (backlog item from 2026-09-21, D-069). Matches every word of
// the query against the file's path, with - _ . and spaces treated alike, so
// "design master" finds ATLAS-DESIGN-MASTER.md. Pure; tested.

export interface NameMatch { relPath: string; score: number }

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[-_.\s]+/g, ' ').trim()

/** Higher is better; null when some query word is missing from the path. */
export function scoreFileName(relPath: string, query: string): number | null {
  const words = norm(query).split(' ').filter(Boolean)
  if (!words.length) return null
  const name = relPath.split('/').pop() || relPath
  const n = norm(name)
  const stem = norm(name.replace(/\.[^.]+$/, ''))
  const p = norm(relPath)
  if (!words.every((w) => p.includes(w))) return null
  const q = words.join(' ')
  let score = 0
  if (stem === q || n === q) score += 1000                  // exact name
  else if (n.startsWith(q)) score += 600                     // name starts with the query
  else if (n.includes(q)) score += 400                       // query as a phrase in the name
  score += words.filter((w) => n.includes(w)).length * 50    // words found in the name, not just folders
  score += words.filter((w) => new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)).length * 20  // at a word start
  score -= Math.min(relPath.split('/').length - 1, 10) * 5   // prefer shallower files
  score -= Math.min(name.length, 80) * 0.1                   // then shorter names
  return score
}

/** Best matches first, ties by path. */
export function rankFileNames(paths: string[], query: string, limit = 50): NameMatch[] {
  const out: NameMatch[] = []
  for (const relPath of paths) {
    const score = scoreFileName(relPath, query)
    if (score !== null) out.push({ relPath, score })
  }
  return out.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath)).slice(0, limit)
}
