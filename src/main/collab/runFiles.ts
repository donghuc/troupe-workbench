// Collab run files (audit #12): the run folder, PLAN.md / STATUS.md, deliverable folders and
// hashes, inputs pasted for agents that can't open files. Split out of orchestrator.ts.
import { hideWorkbenchDir } from '../platform/winFs'
import { join } from 'path'
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, appendFileSync, statSync, readdirSync, readFileSync } from 'fs'
import { logError } from '../util/logger'
import type { CollabRun, CollabTask, CollabTaskDraft } from '../../shared/types'
import { scopePaths } from '../../shared/collabFiles'
import { ensureInside } from '../filesystem/fsService'
import { retargetScope } from '../../shared/collabPlan'
import { providerLabelOf } from './agents'
import { recordText } from './records'

function runDirFor(run: CollabRun): string {
  return join(run.projectCwd, '.workbench', 'collab', run.id)
}

export function relRunDir(run: CollabRun): string {
  return join('.workbench', 'collab', run.id)
}

export const retargetTasks = (drafts: CollabTaskDraft[], runDir: string, outDir: string): CollabTaskDraft[] =>
  drafts.map((d) => ({ ...d, scope: retargetScope(d.scope ?? '', runDir, outDir), acceptance: retargetScope(d.acceptance ?? '', runDir, outDir) }))

export function writePlanMd(run: CollabRun, tasks: CollabTask[]): void {
  try {
    const dir = runDirFor(run)
    mkdirSync(dir, { recursive: true }); hideWorkbenchDir(run.projectCwd)
    const lines = [
      `# Collab plan`, '', `**Goal:** ${run.goal}`, '',
      ...(run.outputDir ? [`**Deliverables folder:** \`${run.outputDir}/\``, ''] : []),
      `_Run by ${providerLabelOf(run.providerId)}. Roles are assigned automatically at run time: each **work** task is carried out by a Maker, then checked by a read-only Reviewer before it counts as done; a **review** task is Reviewer-only._`, '',
      ...tasks.map((t, i) => {
        const deps = t.dependsOn.length ? ` (depends on: ${t.dependsOn.map((d) => {
          const idx = tasks.findIndex((x) => x.id === d); return idx >= 0 ? `#${idx + 1}` : d
        }).join(', ')})` : ''
        return [
          `## ${i + 1}. ${t.title} — ${t.kind}${deps}`,
          t.scope ? `- **Scope:** ${t.scope}` : '',
          t.acceptance ? `- **Acceptance:** ${t.acceptance}` : '',
          t.provider ? `- **Agent:** ${providerLabelOf(t.provider)}` : '',
          t.status === 'skipped' ? `- **Skipped**${t.meta.skipNote ? `: ${t.meta.skipNote}` : ''}` : '',
          ...(t.meta.history ?? []).map((h) => `- **Changed:** ${h}`)
        ].filter(Boolean).join('\n')
      })
    ]
    writeFileSync(join(dir, 'PLAN.md'), lines.join('\n') + '\n', 'utf8')
    // Ensure STATUS.md exists so agents can append to it.
    const status = join(dir, 'STATUS.md')
    try { writeFileSync(status, `# Collab status log\n\nGoal: ${run.goal}\n`, { flag: 'wx' }) } catch { /* exists */ }
  } catch (e) { logError(`[collab] writePlanMd failed: ${String(e)}`) }
}

export function appendStatus(run: CollabRun, line: string): void {
  try {
    const dir = runDirFor(run); mkdirSync(dir, { recursive: true }); hideWorkbenchDir(run.projectCwd)
    appendFileSync(join(dir, 'STATUS.md'), `\n${line}\n`, 'utf8')
  } catch { /* best-effort */ }
}

// A lean summary of finished dependencies for a downstream agent — the compact
// handoff (files + verify) rather than the verbose STATUS.md, which stays a
// human-only audit log. This is what keeps a run's token cost from ballooning.
export function completedContext(run: CollabRun): string {
  const passed = (run.tasks ?? []).filter((t) => t.status === 'passed' && t.handoff)
  if (!passed.length) return ''
  const lines = passed.map((t) => {
    const h = t.handoff!
    const files = h.filesChanged?.length ? h.filesChanged.join(', ') : '(none noted)'
    const rec = recordText(t)
    return `- **${t.title}** — files: ${files}${h.verify ? ` · to check: ${h.verify}` : ''}${rec ? `\n  ${rec.slice(2)}` : ''}`
  })
  return ['## Work already completed by earlier tasks (with what Troupe recorded — facts)', ...lines,
    '', 'Open those files directly if your task builds on them. Do not read the full status log.'].join('\n')
}

export function probeIn(root: string) {
  return (rel: string) => {
    try {
      const abs = ensureInside(root, rel); const st = statSync(abs)
      if (st.isDirectory()) return { kind: 'dir' as const, size: 0, hasFiles: readdirSync(abs).some((n) => !n.startsWith('.')) }
      return { kind: 'file' as const, size: st.size }
    } catch { return { kind: 'none' as const, size: 0 } }
  }
}

// Input files for a text-only Maker: the scope's read-only inputs plus what its
// dependencies produced, pasted in (capped) since it cannot open them itself.
const INLINE_FILE_MAX = 40_000, INLINE_TOTAL_MAX = 120_000

export function inlineInputs(run: CollabRun, task: CollabTask): string {
  const deps = (run.tasks ?? []).filter((t) => task.dependsOn.includes(t.id) && t.status === 'passed')
  const paths = [...scopePaths(task.scope).inputs, ...deps.flatMap((t) => scopePaths(t.scope).outputs)].filter((p, i, a) => a.indexOf(p) === i && !p.endsWith('/'))
  const parts: string[] = []; let total = 0
  for (const p of paths) {
    let text = ''
    try { text = readFileSync(ensureInside(run.projectCwd, p), 'utf8') } catch { parts.push(`### ${p}\n(could not be read)`); continue }
    if (text.includes('\u0000')) continue
    const room = Math.min(INLINE_FILE_MAX, INLINE_TOTAL_MAX - total); if (room <= 0) { parts.push(`### ${p}\n(left out: input limit reached)`); continue }
    const cut = text.length > room ? text.slice(0, room) + `\n… (truncated, ${text.length - room} more characters)` : text
    total += cut.length; parts.push(`### ${p}\n\`\`\`\`\n${cut}\n\`\`\`\``)
  }
  return parts.length ? ['## Input files (pasted by Troupe — you cannot open files yourself)', ...parts].join('\n\n') : ''
}

// D-121: create the deliverables folder and each output's parent folder before a Maker starts,
// so no agent needs a shell command (mkdir) just to have somewhere to write. Grok in Auto can't
// run shell commands at all, and stopped after announcing its plan when it tried.
export function ensureOutputDirs(run: CollabRun, task: CollabTask): void {
  const dirs = new Set<string>(run.outputDir ? [run.outputDir] : [])
  for (const p of scopePaths(task.scope).outputs) dirs.add(p.endsWith('/') ? p : p.split('/').slice(0, -1).join('/'))
  for (const d of dirs) { if (!d) continue; try { mkdirSync(ensureInside(run.projectCwd, d), { recursive: true }) } catch { /* outside the project or not creatable: the gate reports it */ } }
}

// D-111: fingerprint of a task's output files, to tell "nothing changed since the last failure".
export function outputsHash(run: CollabRun, task: CollabTask): string {
  const h = createHash('sha1')
  for (const p of scopePaths(task.scope).outputs) {
    h.update(p + '\0')
    try { const abs = ensureInside(run.projectCwd, p); const st = statSync(abs); h.update(st.isDirectory() ? readdirSync(abs).sort().join('|') : readFileSync(abs)) } catch { h.update('∅') }
  }
  return h.digest('hex').slice(0, 16)
}

export const TASK_NUM = (t: CollabTask) => `T${t.seq + 1}`

// D-121: the files behind the findings, so a fix is based on what was actually written — not
// on what the Maker said it wrote. "changed": compared with the start of the last attempt.
export function outputState(run: CollabRun, task: CollabTask): string[] {
  const outs = task.kind === 'review'
    ? (run.tasks ?? []).filter((t) => t.kind === 'work').flatMap((t) => scopePaths(t.scope).outputs)
    : scopePaths(task.scope).outputs
  if (!outs.length) return []
  const changed = task.kind === 'work' && task.meta.startHash ? (outputsHash(run, task) !== task.meta.startHash ? 'yes' : 'NO — unchanged') : null
  const lines = outs.slice(0, 12).map((p) => {
    try { const st = statSync(ensureInside(run.projectCwd, p)); return `- \`${p}\` — ${st.isDirectory() ? 'folder' : `${st.size} bytes`}` } catch { return `- \`${p}\` — missing` }
  })
  return ['', '## Output files now (open them before proposing a fix)', ...lines, ...(changed ? [`Changed by the last attempt: ${changed}`] : [])]
}
