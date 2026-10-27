// Collab prompts and the app-owned I/O contracts (audit #12): what each role is told and the
// JSON it must answer with. Not in the editable skills. Split out of orchestrator.ts.
import { join } from 'path'
import type { CollabRun, CollabTask, ProviderId } from '../../shared/types'
import { triesText } from '../../shared/collabChecks'
import { textMakerInstructions } from '../../shared/collabFiles'
import { makerProviderOf, providerLabelOf, reviewerOf } from './agents'
import { recordText } from './records'
import { TASK_NUM } from './runFiles'
import { agentTraits } from '../../shared/providers'

// ── machine I/O contracts (app-owned; NOT in the editable skills) ─────────────
export function plannerContract(runDir: string, suggestedOut: string): string {
  return [
    '',
    '---',
    `Where things go: \`${runDir}/\` is the app's bookkeeping folder — only PLAN.md and STATUS.md live there. It is hidden in the app, so NEVER put deliverables under \`.workbench/\`. Choose one visible project folder for everything the tasks produce and set it as "outputDir" (suggested: \`${suggestedOut}\`; reuse an existing project folder if the goal names one). Every task's scope names paths inside outputDir (or existing project files it edits).`,
    `Do not write PLAN.md or STATUS.md yourself — the app writes both from your JSON (a read-only run can't write them anyway). End your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    `{ "outputDir": "${suggestedOut}", "conflicts": [], "tasks": [ { "title": "...", "kind": "work", "provider": "claude-code", "model": "haiku", "reviewer": "codex", "scope": "files or area this task owns", "acceptance": "how anyone can tell it is done and correct", "dependsOn": [] } ] }`,
    '"conflicts": list, in one plain sentence each, anything in the goal that contradicts itself or can\'t all be met (e.g. "the goal asks for 5 questions but also says to write only 4"), and decisions only the user can make before work starts. Leave it empty when there are none. Do NOT quietly pick a side in a task: the user sees these before approving and can edit the goal.',
    '```',
    'Rules: kind is "work" (a Maker builds it, a Reviewer checks it) or "review" (Reviewer-only). dependsOn holds zero-based indices of earlier tasks. Include a final { "kind": "review" } task that checks the whole result against the goal. Keep tasks few and non-overlapping. If a task reads or builds on another task\'s output, it MUST list that task in dependsOn — it will not start until that task has passed review.',
    'For each WORK task, optionally set provider (one of the agents listed below) and model to fit its difficulty and cost: mechanical or read-heavy work → a cheap, fast Claude model ("haiku"); code-heavy work → "codex"; hard synthesis → a strong Claude model ("opus"); "grok" is an alternative generalist. "model" applies to Claude only — omit it for "codex" and "grok". Omit both to use the run default. On a review task, provider and model are ignored.',
    '"reviewer" (optional, any task, including the final review): which agent reviews it — e.g. a different agent from the Maker for an independent check, or the one strongest at the subject. Only agents that read and write files can review. Omit it to use the run default; it always runs on that agent\'s strong model.'
  ].join('\n')
}

export function makerContract(runDir: string): string {
  return [
    '',
    '---',
    `Do not write \`${runDir}/STATUS.md\` — the app records your handoff there from the JSON below. End your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    '{ "status": "done", "filesChanged": ["path", "..."], "verify": "exact steps for the reviewer to verify" }',
    '```',
    'Use "status": "blocked" if you could not complete it; put the reason in the verify field.'
  ].join('\n')
}

export function textMakerContract(files: string[]): string {
  return [
    '',
    '---',
    textMakerInstructions(files),
    '',
    'Then end your reply with ONLY a fenced ```json block, no prose after it:',
    '```json',
    '{ "status": "done", "filesChanged": ["path", "..."], "verify": "exact steps for the reviewer to verify" }',
    '```',
    'Use "status": "blocked" if you could not complete it; put the reason in the verify field.'
  ].join('\n')
}

export function reviewerContract(runDir: string): string {
  return [
    '',
    '---',
    `You are read-only: do not write \`${runDir}/STATUS.md\` or any other file — the app records your verdict there from the JSON below. End your reply with ONLY a fenced \`\`\`json block, no prose after it:`,
    '```json',
    '{ "verdict": "PASS", "findings": [] }',
    '```',
    'verdict is "PASS" only if every acceptance criterion is met with no blocking issue; otherwise "FAIL" with a numbered, specific findings list (each tied to a file or a reproduction step). You do not edit the work.',
    'If you could not check the work at all — you could not open the files, or a tool you need was refused — use "verdict": "BLOCKED" and say in findings what stopped you. That is not the Maker\'s fault: never FAIL for it.',
    'Who made the work and which files changed are settled by Troupe\'s record above. Not having git history, not knowing who wrote a file, or not being able to prove nothing else changed is NOT a reason to BLOCK or FAIL — judge the files against the acceptance criteria.'
  ].join('\n')
}

// ── Planner repair ────────────────────────────────────────────────────────────
export function repairContract(isReview = false): string {
  return [
    ...(isReview ? [
      '', '---',
      'This is the FINAL review of the whole result. Fixes here say which WORK task to redo: use "action": "rework" with "task": its plan number (as in Plan status) and a "note" telling its Maker exactly what to change, from the findings. Offer one rework per task that needs it (up to 3), recommended first. "retry" re-runs this review with a note (only if the review itself was wrong). "skip" accepts the result as it is (changesGoal: true).',
      'Example: { "label": "Redo T2 with the findings", "action": "rework", "task": 2, "changesGoal": false, "note": "Add the missing 5th question and its answer" }'
    ] : []),
    '', '---',
    'Do not edit any files. End your reply with ONLY a fenced ```json block, no prose after it:',
    '```json',
    '{ "summary": "one sentence: why it keeps failing", "recommended": 0, "options": [',
    '  { "label": "short button text, e.g. Give T4 to Codex", "action": "reassign", "provider": "codex", "changesGoal": false, "note": "instruction for the Maker" },',
    '  { "label": "…", "action": "rewrite", "title": "…", "scope": "…", "acceptance": "…", "provider": "optional", "changesGoal": false, "note": "…" },',
    '  { "label": "…", "action": "retry", "changesGoal": false, "note": "what to do differently", "userStep": "optional: what the user must do first" },',
    '  { "label": "…", "action": "skip", "changesGoal": true, "note": "what later tasks should do without it" }',
    '] }',
    '```',
    'Options can only change THIS task: who does it (reassign), its title/scope/acceptance (rewrite), an instruction for its Maker (retry + note), or skipping it. They cannot create files, add tasks or change other tasks — Troupe has no way to do that. If the real fix needs the user to act outside Troupe first (add a missing file, sign in to an agent, install something), say so in "userStep" on a retry/reassign option (e.g. "userStep": "Add README.md to the project folder") — never write a label that promises Troupe will do it.',
    'Keep it short — the user reads this on a small card. "summary": ONE sentence, at most 25 words, plain language. Give 1–3 options; usually one clear best fix is enough, put it first or set "recommended". Labels at most 6 words ("Give T1 to Claude"). "userStep": one short sentence. Do not repeat the same fix with different agents — offer the single best agent. Prefer fixes that keep the goal intact: a different agent that can do the task (see abilities), clearer scope/acceptance, or a concrete instruction. Never offer to retry unchanged.',
    'Every option must be something that can be applied now, from the card. If the cause is in Troupe or an agent\'s setup (an agent can\'t read files, a tool is refused), say so in "summary" and offer reassign or rewrite — never "retry after fixing X" when X needs a change to Troupe\'s code or settings.',
    'Use the agents\' abilities IN THIS RUN (listed below) — not what they can do elsewhere. If a finding says the agent "was blocked asking permission" for a tool, that agent can\'t use it here: give the task to an agent that CAN in this run, or rewrite the task so it doesn\'t need it. If no agent here can, don\'t move it between agents — say so in "summary" and offer a rewrite or skip (Troupe offers the user the run-mode switch itself).',
    '"changesGoal": true ONLY when what gets delivered changes (different content, a dropped output, weaker acceptance). Giving the task to another agent is NOT a goal change, even if the user named the agent.',
    'If the failures come from the GOAL itself (it contradicts itself or the acceptance criteria — e.g. it says to write 4 questions while acceptance needs 5), renaming the task or switching agents will not help, because the next Maker reads the same goal. Then make the recommended option say so, with "changesGoal": true and "goal": the full corrected goal text — the user confirms it before anything changes.'
  ].join('\n')
}

export function readHint(reviewer: ProviderId): string {
  return agentTraits(reviewer).readsFilesByShell
    ? 'You read files through your shell. This run\'s sandbox is read-only, so read-only commands — cat, ls, rg, head, sed -n — are allowed and expected. Don\'t run anything that writes.'
    : 'Read the files with your file-reading tools.'
}

/** Every finding says the Reviewer couldn't open or check the work, and none names a defect. */

export function wrapUpPrompt(run: CollabRun, ending: 'done' | 'stopped'): string {
  const tasks = run.tasks ?? []
  const line = (t: CollabTask) => {
    const who = t.kind === 'review' ? 'review' : providerLabelOf(makerProviderOf(run, t))
    const files = t.handoff?.filesChanged?.length ? ` · files: ${t.handoff.filesChanged.join(', ')}` : ''
    const why = t.status === 'failed' && t.lastVerdict?.findings?.[0] ? ` · last finding: ${t.lastVerdict.findings[0]}` : t.status === 'skipped' && t.meta.skipNote ? ` · ${t.meta.skipNote}` : ''
    // D-121: the real record — every attempt and who made it, and every plan change. The
    // wrap-up once said Grok "was never tested" after Grok had failed twice and Claude took over.
    const tries = t.kind === 'work' && t.meta.tries?.length ? `\n  attempts, in order: ${triesText(t.meta.tries, (a) => providerLabelOf(a))}` : ''
    const changes = t.meta.history?.length ? `\n  plan changes: ${t.meta.history.join('; ')}` : ''
    const rec = t.kind === 'work' ? recordText(t) : ''
    return `- ${TASK_NUM(t)} “${t.title}” — ${t.status.replace('_', ' ')} · ${who}${t.kind === 'work' ? ` · reviewed by ${providerLabelOf(reviewerOf(run, t))}` : ''}${files}${why}${tries}${changes}${rec ? `\n  record: ${rec.slice(2)}` : ''}`
  }
  return [
    `You are the Planner. Write the WRAP-UP for a Collab run that ${ending === 'stopped' ? 'the user STOPPED before it finished' : 'has finished'}. Goal:`, '', run.goal, '',
    '## Tasks', ...tasks.map(line),
    run.outputDir ? `\nDeliverables folder: \`${run.outputDir}/\`` : '',
    '', 'The attempts, plan changes and records above are what happened — report them as they are (who tried, what failed, who took over, and the exact reason a review moved); do not guess or paraphrase a reason into another one.',
    'Open the deliverables to judge them (read only — do not edit any file, do not read STATUS.md in full).',
    'Reply in markdown with exactly these four sections, under 200 words in total, no JSON:',
    '## Outcome', `One or two sentences on what the run actually delivered, judged against the goal — not a restatement of the goal.${ending === 'stopped' ? ' Say what got done, what did not, and where it stopped.' : ''}`,
    '## Files', '- `path` — what it is (one line each)',
    '## Decisions for you', '- choices only the user can make, or "None"',
    '## Follow-ups', '- concrete next steps, or "None"'
  ].filter((l) => l !== '').join('\n')
}

/** Start the wrap-up; false when it can't run (no window, conversation busy). */
