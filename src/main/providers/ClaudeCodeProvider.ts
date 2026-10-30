import { CHROME_ACCESS_SETTING } from '../../shared/providers'
import { buildContextBlock } from './contextBlock'
import { execFileCli, whichWin } from '../platform/proc'
import { writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { claudeMcpToolPrefixes } from '../../shared/projectMcp'
import { removeTempDir } from '../util/tempFiles'
import { join } from 'path'
import { buildEnv } from './env'
import { claudeRunEnv, isClaudeConnector } from '../../shared/claudeConnectors'
import { CliProcess } from './cliProcess'
import { claudeEvents, newClaudeState } from './claudeEvents'
import { getSetting } from '../database/settingsRepo'
import { logInfo } from '../util/logger'
import { configuredClaudeMcpNames, liveClaudeMcpNames } from '../tools/toolsService'
import type { AgentProvider } from './AgentProvider'
import { claudeSandboxSettings, parseDomains, sandboxOn, SHELL_SANDBOX_SETTING, SHELL_DOMAINS_SETTING } from '../../shared/shellSandbox'
import type {
  AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability
} from '../../shared/agent'

/** Windows: Git Bash where Claude Code looks for it (CLAUDE_CODE_GIT_BASH_PATH, Git's default folders, git on PATH). */
function gitBashFound(): boolean {
  const env = buildEnv()
  if (env.CLAUDE_CODE_GIT_BASH_PATH && existsSync(env.CLAUDE_CODE_GIT_BASH_PATH)) return true
  const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[]
  if (pf.some((d) => existsSync(join(d, 'Git', 'bin', 'bash.exe')))) return true
  return !!whichWin('git', env)
}

/** D-146 debug: write one run's flags, appended system prompt and prompt to $TROUPE_DEBUG_PROMPT. */
function dumpForCacheProbe(args: string[], sys: string, prompt: string, cwd?: string, env?: Record<string, string>): void {
  const dir = process.env.TROUPE_DEBUG_PROMPT
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `claude-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), cwd, env, args, sys, prompt }, null, 2), 'utf8')
    logInfo('[claude] prompt saved for cache probe', file)
  } catch (e) { logInfo('[claude] prompt dump failed', String(e)) }
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code' as const
  readonly name = 'Claude'
  private proc = new CliProcess()

  isAvailable(): Promise<ProviderAvailability> {
    return new Promise((resolve) => {
      execFileCli('claude', ['--version'], { env: buildEnv() }, (err, verOut) => {
        if (err) { resolve({ installed: false, authenticated: false, detail: 'claude CLI not found on PATH' }); return }
        // D-120: without Git for Windows, Claude Code uses PowerShell instead of Bash.
        const version = String(verOut).trim() + (process.platform === 'win32' && !gitBashFound() ? ' · Git for Windows not found (Claude will use PowerShell)' : '')
        execFileCli('claude', ['auth', 'status'], { env: buildEnv() }, (_e, statusOut) => {
          let loggedIn = false
          try { loggedIn = !!JSON.parse(String(statusOut)).loggedIn } catch { /* ignore */ }
          resolve({
            installed: true,
            authenticated: loggedIn,
            detail: `${version} · ${loggedIn ? 'Signed in' : 'Not signed in — run: claude auth login'}`
          })
        })
      })
    })
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, streamingDeltas: true, sessionResume: true,
      fileRead: true, fileWrite: true, shell: getSetting('agent_shell_access') !== '0', web: true, mcp: true,
      images: true, structuredOutput: true, systemPromptInjection: true,
      permissionModel: 'per-tool'
    }
  }

  async *run(req: AgentRequest, resumeSessionId?: string): AsyncIterable<AgentEvent> {
    const ctx = req.context
    // Conversation transcript goes in the PROMPT, not the system prompt: on a resumed turn
    // (D-146) there is none, and the project context still arrives through
    // --append-system-prompt-file (checked on Claude Code, 2026-10-30).
    const preamble = [ctx?.skillText, ctx?.snapshot, ctx?.attachmentsText].filter(Boolean).join('\n\n')
    const prompt = preamble ? `${preamble}\n\n---\n\nUser: ${req.prompt}` : req.prompt
    // Permission mode (D-029). Headless -p can't prompt, so tools are pre-approved via
    // --allowedTools; the mode picks how permissive that is. 'read' is read-only;
    // 'auto' (default) auto-accepts edits with the settings-gated tool set; 'full'
    // bypasses all permissions.
    const mode = req.permissionMode ?? 'auto'
    const webAccess = getSetting('agent_web_access') !== '0'
    const shellAccess = getSetting('agent_shell_access') !== '0'
    // Claude in Chrome (Settings ▸ Tools, off by default): `--chrome` loads the
    // extension's browser tools, which act in the user's own signed-in Chrome. Not in
    // read-only mode — the tools click and type. Verified working in headless -p
    // (2026-09-28); "Enabled by default" in /chrome does NOT apply to -p runs.
    const chromeAccess = getSetting(CHROME_ACCESS_SETTING) === '1' && mode !== 'read'
    const readOnly = ['Read', 'Grep', 'Glob']
    let permFlag = 'acceptEdits'
    // D-120: Claude Code has no sandbox on native Windows, so with "Sandbox in Auto" on, Auto
    // pre-approves no shell tool there (D-115's guarantee holds by not running commands).
    // Windows also has a PowerShell tool (used when Git for Windows is missing).
    const win = process.platform === 'win32'
    const sandboxed = sandboxOn(getSetting(SHELL_SANDBOX_SETTING))
    const shellTools = win ? (sandboxed ? [] : ['Bash', 'PowerShell']) : ['Bash']
    let allowed = [...readOnly, ...(webAccess ? ['WebSearch', 'WebFetch'] : []), ...(shellAccess ? shellTools : [])]
    if (mode === 'read') { permFlag = 'default'; allowed = [...readOnly, ...(req.allowWeb && webAccess ? ['WebSearch', 'WebFetch'] : [])] }
    else if (mode === 'full') { permFlag = 'bypassPermissions'; allowed = [...readOnly, 'Bash', 'WebSearch', 'WebFetch', 'Write', 'Edit'] }
    // Pre-approve configured MCP servers (e.g. browser tools) so their tools aren't
    // denied in headless -p — except in read-only mode. `mcp__<server>` allows all of
    // that server's tools (D-030).
    if (mode !== 'read') {
      // Claude namespaces MCP tools as mcp__<server>__<tool>; the prefix must match its
      // spelling of the server name (B-029 dots/spaces → _, B-050 dashes kept).
      const mcpNames = new Set<string>([...configuredClaudeMcpNames(req.cwd), ...liveClaudeMcpNames()])
      const off = new Set(req.mcpOff ?? [])
      allowed.push(...[...mcpNames].filter((n) => !off.has(n)).flatMap(claudeMcpToolPrefixes))
    }
    // 'auto' (default) keeps acceptEdits + the settings-gated tool set above.
    // The prompt goes over STDIN, not argv (D-060 item 3): argv is capped at ~1 MiB on
    // macOS (spawn E2BIG once transcript + context grow) and is readable by every local
    // process via `ps`. `claude -p` with no positional prompt reads the prompt from stdin.
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', permFlag]
    if (chromeAccess) { args.push('--chrome'); allowed.push('mcp__claude-in-chrome') }
    args.push('--allowedTools', ...allowed)
    // Servers switched off for this project (D-075): deny their tools so they are not
    // offered to the model (their definitions otherwise ride along on every step).
    if (req.mcpOff?.length) args.push('--disallowedTools', ...req.mcpOff.flatMap(claudeMcpToolPrefixes))
    // Additional folders this run may read and edit (D-054). `--add-dir` is variadic,
    // so it must not sit directly before a positional argument; `-p prompt` is already
    // first, so appending here is safe.
    if (req.addDirs?.length) args.push('--add-dir', ...req.addDirs)
    // D-115: in Auto, shell commands run in Claude Code's sandbox (writes in the project
    // and added folders only, listed sites only, fails closed). Full access skips it.
    if (mode === 'auto' && shellAccess && sandboxed && !win) {
      args.push('--settings', claudeSandboxSettings(parseDomains(getSetting(SHELL_DOMAINS_SETTING))))
    }
    if (req.model) args.push('--model', req.model)
    // D-146: a resumed turn forks — a new session id each turn, so a message you later delete or
    // edit in Troupe can never come back from the agent's own copy of the chat.
    if (resumeSessionId) args.push('--resume', resumeSessionId, '--fork-session')

    // Project-level context (Instructions/Memory/Persistent Context) via system
    // prompt append, without writing into the project folder (D-003).
    // CLAUDE.md is the canonical memory file and Claude Code auto-loads it from the
    // cwd, so injection is skipped exactly when delivery is native (D-055).
    // With Chrome on, say which web route is which so the model doesn't guess (D-085).
    const webRouting = chromeAccess
      ? 'Web routing: use WebSearch to find things and WebFetch for public pages. For any page that needs a login, or clicking and typing, use the Claude in Chrome tools (mcp__claude-in-chrome), which run in the user\'s own signed-in browser. Use Playwright only when the user asks for it.'
      : undefined
    // Global memory lives in ~/.claude/CLAUDE.md, which Claude auto-loads, so it's never injected (D-055).
    const sys = buildContextBlock('claude-code', req, { withTurnContext: false, tail: webRouting })
    // The system-prompt file lives in a temp folder that is removed when the run ends (audit #10).
    let tempDir: string | null = null
    if (sys.trim()) {
      const dir = mkdtempSync(join(tmpdir(), 'workbench-ctx-'))
      tempDir = dir
      const file = join(dir, 'context.md')
      writeFileSync(file, sys, 'utf8')
      args.push('--append-system-prompt-file', file)
    }

    // D-146: TROUPE_DEBUG_PROMPT=<folder> saves what this run sends (flags, appended context,
    // prompt) for scripts/cache-probe.mjs. Off unless the variable is set; stays on this Mac.
    // D-146: the same MCP tools on every call of every turn — wait for servers, tool search,
    // and no claude.ai connectors at all when you've switched every one off.
    const baseEnv = buildEnv()
    const runEnv = claudeRunEnv(baseEnv, liveClaudeMcpNames().filter(isClaudeConnector), new Set(req.mcpOff ?? []))
    dumpForCacheProbe(args, sys, prompt, req.cwd, runEnv)

    const st = newClaudeState()
    try {
      yield* this.proc.jsonl({
        bin: 'claude', args, cwd: req.cwd, stdin: prompt, env: { ...baseEnv, ...runEnv },
        onMapError: (err) => logInfo('[claude] frame mapping failed', String(err)),
        onJson: (e, push) => {
          for (const ev of claudeEvents(e, st)) {
            if (ev.type === 'error') logInfo('[claude] error result', JSON.stringify({ subtype: e.subtype, is_error: e.is_error }))
            push(ev)
          }
        }
      })
    } finally {
      removeTempDir(tempDir)
    }
  }

  async cancel(): Promise<void> { this.proc.cancel() }
}
