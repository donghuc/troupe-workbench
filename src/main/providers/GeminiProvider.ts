import { execFileCli } from '../platform/proc'
import { buildContextBlock, withPreamble } from './contextBlock'
import { logInfo, logError } from '../util/logger'
import type { AgentProvider } from './AgentProvider'
import type { AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability } from '../../shared/agent'
import { buildEnv } from './env'
import { CliProcess } from './cliProcess'
import { geminiEvents, geminiPermissionArgs, newGeminiState } from './geminiEvents'

// Google's Antigravity CLI (`agy`), the Gemini CLI's successor (D-079). Run headless with
// streaming JSON both ways: the prompt goes in over stdin as one user event (no argv size
// limit, not visible in `ps` — same as Claude/Codex, D-060 item 3), replies stream out.
const GEMINI_EFFORT = 'high'

export class GeminiProvider implements AgentProvider {
  readonly id = 'gemini' as const
  readonly name = 'Gemini'
  private proc = new CliProcess()

  isAvailable(): Promise<ProviderAvailability> {
    // D-120: agy -p hangs when it isn't run from a terminal on Windows (antigravity-cli #318),
    // which is exactly how Troupe runs it — so it stays off there, installed or not.
    if (process.platform === 'win32') return Promise.resolve({ installed: false, authenticated: false, detail: 'Not available on Windows yet' })
    return new Promise((resolve) => {
      execFileCli('agy', ['--version'], { env: buildEnv(), timeout: 15000 }, (err: any, out, errOut) => {
        // Only a missing binary means "not installed"; a non-zero exit (unknown flag) still proves it's there.
        if (err && (err.code === 'ENOENT' || err.errno === -2)) { resolve({ installed: false, authenticated: false, detail: 'agy (Antigravity CLI) not found on PATH' }); return }
        // No machine-readable sign-in check; a signed-out agy surfaces as a run error.
        resolve({ installed: true, authenticated: true, detail: String(out || errOut || 'agy').trim().split('\n')[0] })
      })
    })
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, streamingDeltas: true, sessionResume: true,
      fileRead: true, fileWrite: true, shell: true, web: true, mcp: true,
      images: true, structuredOutput: true, systemPromptInjection: false,
      permissionModel: 'sandbox-level'
    }
  }

  async *run(req: AgentRequest, resumeSessionId?: string): AsyncIterable<AgentEvent> {
    if (process.platform === 'win32') { yield { type: 'error', message: 'Gemini is not available on Windows yet.', fatal: true }; return }
    // No system-prompt flag → context goes in a delimited preamble, like Codex/Grok (D-003).
    const mode = req.permissionMode ?? 'auto'
    // Read-only: agy refuses every tool that needs approval and a refused step can end the
    // run with no answer at all (seen with a web-research prompt that reached for a shell
    // command). Tell Gemini up front what it can use so it doesn't try (D-079).
    const readNote = mode === 'read'
      ? 'You are in read-only mode: you cannot run terminal commands or create or edit files — those tools will be refused. You can read files, search the web and read web pages. Answer directly in your reply.'
      : ''
    const prompt = withPreamble(buildContextBlock('gemini', req, { lead: readNote }), req.prompt)

    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', ...geminiPermissionArgs(mode)]
    // Troupe offers one entry per model (effort variants collapsed, D-079), but agy then
    // requires --effort. Every Gemini model offers "high" (Pro: low/high; Flash: low/medium/high),
    // and research wants depth, so pin it until there's an effort picker.
    if (req.model) args.push('--model', req.model, '--effort', GEMINI_EFFORT)
    if (resumeSessionId) args.push('--conversation', resumeSessionId)
    if (req.addDirs?.length) logInfo('[gemini] additional folders not passed (agy has no per-run flag known yet)', JSON.stringify(req.addDirs))
    logInfo('[gemini] run', JSON.stringify({ model: req.model || 'default', mode, resume: resumeSessionId ?? null }))

    let completed = false
    const st = newGeminiState()
    yield* this.proc.jsonl({
      bin: 'agy', args, cwd: req.cwd,
      stdin: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
      onRaw: process.env.WB_GEMINI_RAW ? (t) => logInfo('[gemini:raw] ' + t.slice(0, 2000)) : undefined,
      onMapError: (err) => logError('[gemini] event mapping failed', String(err)),
      onJson: (e, push) => { for (const ev of geminiEvents(e, st, req.model)) { if (ev.type === 'complete') completed = true; push(ev) } },
      onClose: (code, stderr, push) => {
        if (code && code !== 0 && !completed) push({ type: 'error', message: cleanError(stderr) || `agy exited with code ${code}`, fatal: true })
        else if (!completed) push({ type: 'complete', usage: {} })
      }
    })
  }

  async cancel(): Promise<void> { this.proc.cancel() }
}

function cleanError(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines.find((l) => /error|denied|unauthor|sign|login|quota|limit/i.test(l)) ?? lines[0] ?? '').replace(/^Error:\s*/i, '')
}
