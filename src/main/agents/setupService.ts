// Agent setup from inside Troupe (2.3, Part A): run a bundled recipe's install or sign-in,
// stream its output to the window, or open it in Terminal. The window sends only an agent
// id — every command comes from the recipes bundled with the app (trust rules, spec §Security).
import type { WebContents } from 'electron'
import { spawn } from 'child_process'
import { writeFileSync, chmodSync, unlink } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { BUILTIN_RECIPES, presetRecipe } from '../../shared/agentRecipes'
import { isProviderId, isBuiltinId } from '../../shared/providers'
import { IPC } from '../../shared/ipc'
import type { SetupEvent } from '../../shared/agentSetup'
import type { ProviderId } from '../../shared/types'
import { buildEnv, resetLoginPath, refreshLoginPath } from '../providers/env'
import { createProvider } from '../providers/registry'
import { findPresetBin } from '../providers/CustomCliProvider'
import { logInfo, logError } from '../util/logger'
import { setupPlan, commandFileContents, ps1FileContents, powershellExe, SETUP_TIMEOUT_MS, type SetupKind } from './setupRules'
import { runSetupCommand, type SetupHandle } from './setupProcess'

const running = new Map<string, SetupHandle>()

function send(sender: WebContents, ev: SetupEvent) { if (!sender.isDestroyed()) sender.send(IPC.agentSetup, ev) }

/** Open a command in a new Terminal window via a temporary .command file (no AppleScript). */
function openInTerminal(cmd: string): void {
  if (process.platform === 'win32') { openInPowerShell(cmd); return }
  const shell = process.env.SHELL || '/bin/zsh'
  const file = join(tmpdir(), `troupe-setup-${randomBytes(4).toString('hex')}.command`)
  writeFileSync(file, commandFileContents(cmd, shell, buildEnv().PATH), { mode: 0o700 })
  chmodSync(file, 0o700)
  spawn('open', [file], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => unlink(file, () => {}), 10 * 60_000).unref()   // Terminal has read it long before
}

/** Windows (D-120): a new PowerShell window (detached = its own console) runs a temporary .ps1. */
function openInPowerShell(cmd: string): void {
  const file = join(tmpdir(), `troupe-setup-${randomBytes(4).toString('hex')}.ps1`)
  writeFileSync(file, ps1FileContents(cmd, buildEnv().PATH))
  spawn(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', file], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => unlink(file, () => {}), 10 * 60_000).unref()
}

export function startSetup(sender: WebContents, id: unknown, kind: unknown, terminal?: unknown): { runId: string | null; mode: 'run' | 'terminal' | 'none' } {
  // Built-ins and bundled presets (2.4) have recipes; a custom agent typed in the form has
  // no install step. Presets always open in Terminal: the user sees the installer run.
  const preset = typeof id === 'string' && !isBuiltinId(id) ? presetRecipe(id) : undefined
  if (!isBuiltinId(id) && !preset) throw new Error('Unknown agent')
  if (kind !== 'install' && kind !== 'signIn') throw new Error('Unknown setup step')
  const recipe = preset ?? BUILTIN_RECIPES[id as keyof typeof BUILTIN_RECIPES]
  const plan = setupPlan(recipe, kind as SetupKind)
  // "Open in Terminal" after a failed background step (or a sign-in that needs a terminal).
  if ((terminal === true || preset) && plan.mode === 'run') plan.mode = 'terminal'
  // A preset may install under another of its names (Cursor: `agent` or `cursor-agent`):
  // sign in with the one that's actually on this Mac.
  if (preset && kind === 'signIn') {
    const first = plan.cmd.split(' ')[0]
    const found = preset.detect.includes(first) ? findPresetBin(preset.id, preset.detect) : null
    if (found && found !== first) plan.cmd = found + plan.cmd.slice(first.length)
  }
  logInfo('agent setup', { agent: id, kind, mode: plan.mode })
  if (plan.mode === 'none') return { runId: null, mode: 'none' }
  if (plan.mode === 'terminal') { openInTerminal(plan.cmd); return { runId: null, mode: 'terminal' } }
  const runId = randomBytes(6).toString('hex')
  const handle = runSetupCommand(plan.cmd, {
    env: buildEnv(),
    timeoutMs: SETUP_TIMEOUT_MS[kind as SetupKind],
    onLine: (line) => send(sender, { runId, agent: id as ProviderId, kind: kind as SetupKind, line })
  })
  running.set(runId, handle)
  void handle.done.then((r) => {
    running.delete(runId)
    if (r.ok && kind === 'install') resetLoginPath()   // a new binary may live in a new PATH dir
    if (!r.ok) logError('agent setup failed', { agent: id, kind, code: r.code, timedOut: r.timedOut, cancelled: r.cancelled })
    send(sender, { runId, agent: id as ProviderId, kind: kind as SetupKind, done: r })
  })
  return { runId, mode: 'run' }
}

export function cancelSetup(runId: unknown): void {
  if (typeof runId === 'string') running.get(runId)?.cancel()
}

/** Fresh status for one agent. `fresh` re-reads the login-shell PATH (after an install). */
export async function checkAgent(id: unknown, fresh?: boolean) {
  if (!isProviderId(id)) throw new Error('Unknown agent')
  if (fresh) await refreshLoginPath()   // audit #5: without blocking the main process
  const p = createProvider(id as ProviderId)
  if (!p) throw new Error('Unknown agent')
  return p.isAvailable()
}
