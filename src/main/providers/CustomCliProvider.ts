import { accessSync, constants } from 'fs'
import { join, isAbsolute } from 'path'
import { workFolderRules } from '../../shared/contextBudget'
import { buildRun, type CustomAgent } from '../../shared/customAgents'
import { logInfo, logError } from '../util/logger'
import type { AgentProvider } from './AgentProvider'
import type { AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability } from '../../shared/agent'
import { buildEnv } from './env'
import { CliProcess, stderrLine } from './cliProcess'
import { memoryDelivery, globalMemoryDelivery } from '../context/projectMemory'
import { claudeEvents, newClaudeState } from './claudeEvents'

// A user-added agent (Troupe 2.4): any CLI that takes one prompt, prints a reply and exits.
// Run directly (never through a shell); the prompt goes over stdin, or into the one
// argument that holds {prompt}. Troupe owns continuity, so there's no session resume:
// every run gets the full context in a delimited preamble, like Codex and Gemini (D-003).

/** Where `bin` resolves on the merged PATH, or null. No execution — just a lookup. */
export function whichBin(bin: string, env: NodeJS.ProcessEnv = buildEnv()): string | null {
  const ok = (p: string) => { try { accessSync(p, constants.X_OK); return true } catch { return false } }
  if (bin.includes('/')) return isAbsolute(bin) && ok(bin) ? bin : null
  for (const dir of (env.PATH ?? '').split(':')) if (dir && ok(join(dir, bin))) return join(dir, bin)
  return null
}

export const READ_ONLY_NOTE = 'You are in read-only mode: do not create, edit or delete files and do not run commands that change anything. Read and answer in your reply.'

export class CustomCliProvider implements AgentProvider {
  readonly id: CustomAgent['id']
  readonly name: string
  private proc = new CliProcess()

  constructor(private agent: CustomAgent, private timeoutMs?: number) {
    this.id = agent.id
    this.name = agent.name
  }

  async isAvailable(): Promise<ProviderAvailability> {
    const path = whichBin(this.agent.bin)
    // No general sign-in check; a signed-out agent shows up as a run error.
    return path
      ? { installed: true, authenticated: true, detail: path }
      : { installed: false, authenticated: false, detail: `${this.agent.bin} not found on PATH` }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, streamingDeltas: true, sessionResume: false,
      fileRead: false, fileWrite: false, shell: false, web: false, mcp: false,
      images: false, structuredOutput: this.agent.output === 'claude-stream-json', systemPromptInjection: false,
      permissionModel: this.agent.readOnlyArgs?.length ? 'sandbox-level' : 'none'
    }
  }

  async *run(req: AgentRequest): AsyncIterable<AgentEvent> {
    const ctx = req.context
    const memory = memoryDelivery(this.id, req.cwd ?? null, ctx?.memory ?? '') === 'injected' ? ctx?.memory : undefined
    const globalMemory = globalMemoryDelivery(this.id, ctx?.globalMemory ?? '') === 'injected' ? ctx?.globalMemory : undefined
    const readOnly = (req.permissionMode ?? 'auto') === 'read'
    // Without read-only flags the mode can only be asked for, not enforced (the picker says so).
    const readNote = readOnly && !this.agent.readOnlyArgs?.length ? READ_ONLY_NOTE : ''
    const block = [readNote, ctx?.instructions, globalMemory, memory, ctx?.persistentContext, workFolderRules(req.cwd, req.addDirs), ctx?.skillText, ctx?.snapshot, ctx?.attachmentsText].filter(Boolean).join('\n\n')
    const prompt = block.trim() ? `<workbench_context>\n${block}\n</workbench_context>\n\n${req.prompt}` : req.prompt

    let run: { args: string[]; stdin: string }
    try { run = buildRun(this.agent, { prompt, model: req.model, readOnly }) } catch (err) {
      yield { type: 'error', message: (err as Error).message, fatal: true }
      return
    }
    logInfo(`[custom:${this.id}] run`, JSON.stringify({ bin: this.agent.bin, args: run.args.length, viaStdin: !!run.stdin, model: req.model || 'default', readOnly }))

    if (this.agent.output === 'claude-stream-json') {
      const st = newClaudeState()
      let completed = false
      yield* this.proc.jsonl({
        bin: this.agent.bin, args: run.args, cwd: req.cwd, stdin: run.stdin, label: this.agent.name,
        onMapError: (err) => logError(`[custom:${this.id}] frame mapping failed`, String(err)),
        onJson: (e, push) => { for (const ev of claudeEvents(e, st)) { if (ev.type === 'complete') completed = true; push(ev) } },
        onClose: (code, stderr, push) => {
          if (code && code !== 0 && !completed) push({ type: 'error', message: stderrLine(stderr) || `${this.agent.name} exited with code ${code}`, fatal: true })
          else if (!completed) push({ type: 'complete', usage: {} })
        }
      })
      return
    }
    yield* this.proc.text({ bin: this.agent.bin, args: run.args, cwd: req.cwd, stdin: run.stdin, label: this.agent.name, timeoutMs: this.timeoutMs })
  }

  async cancel(): Promise<void> { this.proc.cancel() }
}
