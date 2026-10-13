// Pure rules for agent setup (Troupe 2.3, Part A). No electron imports: tested directly.
import type { AgentRecipe } from '../../shared/agentRecipes'

export type SetupKind = 'install' | 'signIn'

/** How long a step may run before it is stopped. */
export const SETUP_TIMEOUT_MS: Record<SetupKind, number> = { install: 10 * 60_000, signIn: 5 * 60_000 }

/**
 * What to do for a step: run it in the background, open it in a Terminal window (interactive
 * sign-ins, installs that need a password), or nothing (no command in the recipe).
 * The command always comes from the bundled recipe — never from the window.
 */
export function setupPlan(recipe: AgentRecipe, kind: SetupKind): { mode: 'run' | 'terminal' | 'none'; cmd: string } {
  if (kind === 'install') {
    if (!recipe.install) return { mode: 'none', cmd: '' }
    return { mode: recipe.install.manualOnly ? 'terminal' : 'run', cmd: recipe.install.cmd }
  }
  if (!recipe.signIn) return { mode: 'none', cmd: '' }
  return { mode: recipe.signIn.terminal ? 'terminal' : 'run', cmd: recipe.signIn.cmd }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]/g

/** Strip colour codes and carriage-return redraws (progress bars keep their last frame). */
export function cleanLine(raw: string): string {
  const noAnsi = raw.replace(ANSI_RE, '')
  const frames = noAnsi.split('\r')
  return (frames.filter((f) => f.trim()).pop() ?? '').trimEnd()
}

/** The most useful line to show when a step fails: the last one that reads like an error. */
export function lastErrorLine(lines: string[]): string {
  const real = lines.map((l) => l.trim()).filter(Boolean)
  for (let i = real.length - 1; i >= 0; i--) if (/error|fail|denied|not found|cannot|can't|unable/i.test(real[i])) return real[i].slice(0, 300)
  return (real[real.length - 1] ?? 'It stopped without saying why.').slice(0, 300)
}

/** A `.command` file Terminal runs when opened — no AppleScript, so no "control Terminal" prompt. */
export function commandFileContents(cmd: string, shell: string): string {
  return [
    `#!${shell} -l`,
    '# Opened by Troupe to finish setting up an agent. You can read every line before it runs.',
    'clear',
    `echo '$ ${cmd.replace(/'/g, `'\\''`)}'`,
    cmd,
    'echo',
    'echo "Done. You can close this window and go back to Troupe."',
    ''
  ].join('\n')
}
