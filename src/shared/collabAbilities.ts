// What each agent can actually do IN THIS RUN (D-127). Collab used to describe agents by their
// general abilities ("Grok: reads and writes files"), so in a Read-only run the Planner handed a
// file-writing task from Claude to Grok to Claude, each refused for the same reason — the run's
// own mode, which no agent can get past. Abilities here are the agent's own capabilities cut by
// the run's mode and the Tools settings, and a failure caused by something no agent in the run
// has is the run's problem (the user changes the mode or a setting), not the agent's.
import type { PermissionMode } from './agent'

export interface AgentCaps { fileWrite: boolean; shell: boolean; web: boolean }
export interface RunSettings {
  mode: PermissionMode
  webOn: boolean        // Settings ▸ Tools ▸ Web access
  shellOn: boolean      // Settings ▸ Tools ▸ Shell commands
  sandboxOn: boolean    // Settings ▸ Tools ▸ Sandbox in Auto
  windows: boolean
}
export interface Ability {
  read: boolean         // opens project files itself
  write: boolean        // changes project files itself
  shell: boolean        // runs commands without stopping at a prompt
  web: boolean
}
export type Need = 'write' | 'shell' | 'web'

export function abilityIn(id: string, caps: AgentCaps | null, s: RunSettings): Ability {
  const c = caps ?? { fileWrite: false, shell: false, web: false }
  const ro = s.mode === 'read'
  return {
    read: c.fileWrite,
    write: c.fileWrite && !ro,
    // Grok's shell always stops at a prompt outside Full access: it can't be pre-approved and
    // `--disallowed-tools` doesn't remove it (its session logs, 2026-10-20). Claude Code has no
    // sandbox on Windows, so "Sandbox in Auto" means no shell there.
    shell: c.shell && s.shellOn && !ro && !(id === 'grok' && s.mode !== 'full') && !(s.windows && id === 'claude-code' && s.mode === 'auto' && s.sandboxOn),
    web: c.web && s.webOn && !ro
  }
}

export function describeAbility(a: Ability): string {
  if (!a.read) return 'text replies only: cannot open project files, browse the web or run tools. Troupe pastes the task\'s input files into its prompt and saves its deliverables from the reply'
  return [
    a.write ? 'reads and writes files' : 'reads files; cannot change them — Troupe saves its deliverables from its reply',
    a.shell ? 'runs shell commands' : 'cannot run commands',
    a.web ? 'can browse the web' : 'no web'
  ].join(', ')
}

const MODE_WORD: Record<PermissionMode, string> = { read: 'Read-only', auto: 'Auto', full: 'Full access' }

/** One line for the Planner: what nobody in this run can do. */
export function runLimits(s: RunSettings, all: Ability[]): string {
  const none = (k: keyof Ability) => !all.some((a) => a[k])
  const cant: string[] = []
  if (none('write')) cant.push('change project files (Makers put each deliverable in their reply and Troupe saves it)')
  if (none('shell')) cant.push('run commands — no builds, tests, scripts or installs')
  if (none('web')) cant.push('use the web')
  return `This run is ${MODE_WORD[s.mode]}.` + (cant.length ? ` No agent in it can ${cant.join('; nor ')}. Don't plan tasks that need these; if the goal needs them, say so in "conflicts" — the user can switch the run to Auto before approving.` : '')
}

/** What a blocked tool needed. Names from Claude, Codex and Grok. */
export function needOfTool(tool: string): Need | null {
  const t = tool.toLowerCase()
  if (/^(write|edit|multiedit|notebookedit|search_replace|apply_patch|create_file|str_replace)/.test(t)) return 'write'
  if (/(bash|shell|terminal|command|exec)/.test(t)) return 'shell'
  if (/(web_?fetch|web_?search|browse|http)/.test(t)) return 'web'
  return null
}

/** What a Maker's "I'm blocked" reason says it lacked, when it's about permissions. */
export function needOfText(text: string): Need | null {
  const t = text.toLowerCase()
  // Only reasons about permissions or the run's mode — not "can't find the file".
  if (!/(read-only|readonly|permission|not permitted|not allowed|denied|auto mode|switch to auto|sandbox)/.test(t)) return null
  if (/(read-only|readonly|write|edit|modify|create (the )?file|save (the )?file|auto mode|switch to auto)/.test(t)) return 'write'
  if (/(shell|terminal|command|bash|run(ning)? (the )?(tests?|build|script))/.test(t)) return 'shell'
  if (/(web|internet|fetch|browse|url)/.test(t)) return 'web'
  return null
}

/** The run can't do this at all: nobody here has it. Would Auto give it to someone? */
export function runBlocker(need: Need, here: Ability[], inAuto: Ability[]): { mode: boolean } | null {
  if (here.some((a) => a[need])) return null          // an agent in this run can: the agent's problem
  return { mode: inAuto.some((a) => a[need]) }         // nobody can: the run's
}

export const NEED_WORD: Record<Need, string> = { write: 'change project files', shell: 'run commands', web: 'use the web' }
