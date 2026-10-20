import { workFolderRules } from '../../shared/contextBudget'
import { fileBase } from '../../shared/platform'
import { execFileCli } from '../platform/proc'
import { writtenByOthers } from '../agent/recentWrites'
import { logInfo, logError } from '../util/logger'
import { promises as fsp } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { AgentProvider } from './AgentProvider'
import type {
  AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability
} from '../../shared/agent'
import { buildEnv } from './env'
import { getSetting } from '../database/settingsRepo'
import { CliProcess, mediaFilesSince } from './cliProcess'
import { memoryDelivery, globalMemoryDelivery } from '../context/projectMemory'

// xAI's `grok` CLI (grok-build), run headless: `grok -p "<prompt>" --output-format json`.
// Phase 0: non-streaming — we read the single JSON result on close and emit the whole
// reply as one text_delta. Grok's --permission-mode mirrors Claude Code's, so we map
// read → plan (no edits), auto → acceptEdits, full → bypassPermissions. All are
// non-interactive (no approval prompt to hang a headless run).
export class GrokProvider implements AgentProvider {
  readonly id = 'grok' as const
  readonly name = 'Grok'
  private proc = new CliProcess()
  private cancelled = false

  isAvailable(): Promise<ProviderAvailability> {
    return new Promise((resolve) => {
      execFileCli('grok', ['--version'], { env: buildEnv() }, (err, verOut, verErr) => {
        if (err) { resolve({ installed: false, authenticated: false, detail: 'grok CLI not found on PATH' }); return }
        // No documented machine-readable login-status command; report installed and
        // assume authenticated (a failed key surfaces as a run error).
        resolve({ installed: true, authenticated: true, detail: `${String(verOut || verErr).trim().split('\n')[0]}` })
      })
    })
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true, streamingDeltas: false, sessionResume: true,
      fileRead: true, fileWrite: true, shell: true, web: true, mcp: true,
      images: true, structuredOutput: true, systemPromptInjection: false,
      permissionModel: 'sandbox-level'
    }
  }

  // Spawn grok once, collect stdout/stderr, resolve on close; cancel() kills it (D-096).
  private exec(args: string[], cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return this.proc.exec('grok', args, cwd)
  }

  async *run(req: AgentRequest, resumeSessionId?: string): AsyncIterable<AgentEvent> {
    this.cancelled = false
    const ctx = req.context
    // Grok has no system-prompt flag → prepend context as a delimited preamble (D-003).
    // Memory is always injected for Grok (no known native memory file); D-055 rule.
    const memory = memoryDelivery('grok', req.cwd ?? null, ctx?.memory ?? '') === 'injected' ? ctx?.memory : undefined
    const globalMemory = globalMemoryDelivery('grok', ctx?.globalMemory ?? '') === 'injected' ? ctx?.globalMemory : undefined
    const mode0 = req.permissionMode ?? 'auto'
    const block = [ctx?.instructions, globalMemory, memory, ctx?.persistentContext, workFolderRules(req.cwd, req.addDirs), grokModeRule(mode0, req.toolProfile), ctx?.skillText, ctx?.snapshot, ctx?.attachmentsText].filter(Boolean).join('\n\n')
    const prompt = block.trim()
      ? `<workbench_context>\n${block}\n</workbench_context>\n\n${req.prompt}`
      : req.prompt

    const mode = req.permissionMode ?? 'auto'
    // Grok mirrors Claude Code's permission modes; all three are non-interactive.
    const permMode = mode === 'read' ? 'plan' : mode === 'full' ? 'bypassPermissions' : 'acceptEdits'
    // Image canvas runs (D-088): Grok's image_gen/image_edit aren't covered by acceptEdits
    // (the call is refused and the turn ends "permission_cancelled"), and --allow has no
    // rule for them. So: auto-approve, but strip the toolset to reading + the image tools —
    // no shell, no web, no file edits. Grok saves into its session dir; the B-042 recovery
    // below copies the images into the project, where the Image service collects them.
    const permFlags = req.toolProfile === 'image'
      // B-051: also strip its MCP gateway (search_tool/use_tool) and deny every MCP call — with
      // no shell, Grok had used the Paper MCP server to try to move its image (and edited the
      // user's Paper file) for 10 minutes.
      ? ['--always-approve', '--tools', 'read_file,list_dir,image_gen,image_edit', '--disallowed-tools', 'search_tool,use_tool', '--deny', 'MCPTool']
      : grokPermFlags(mode, { web: getSetting('agent_web_access') !== '0', allowWeb: !!req.allowWeb })
    const argsFor = (flags: string[]) => { const a = ['-p', prompt, '--output-format', 'json', ...flags]; if (req.model) a.push('-m', req.model); return a }
    const common = argsFor(permFlags)
    const raw = !!process.env.WB_GROK_RAW

    logInfo('[grok] run', JSON.stringify({ model: req.model || 'default', permMode: req.toolProfile === 'image' ? 'image-tools' : permMode, resume: resumeSessionId ?? null }))
    yield { type: 'status', message: 'Working…' }
    const imgSince = Date.now() - 1000

    // The runner injects the transcript each turn and never passes a resume id (by
    // design — see agent/runner.ts), so --resume is effectively unused today; kept as
    // a passthrough for a future Phase-10 native-resume mode. (B-041)
    let res = await this.exec(resumeSessionId ? [...common, '--resume', resumeSessionId] : common, req.cwd)
    // D-121: grok refuses to start a session when a tool we removed is required by one we kept
    // (test 6: exit_plan_mode needs enter_plan_mode; scheduler_list needs the scheduler). Its
    // error names each unsatisfied tool: remove those too, remember them, and start once more.
    if (res.code && req.toolProfile !== 'image' && !this.cancelled && grokToolsListRejected(`${res.stderr}\n${res.stdout}`)) {
      logInfo('[grok] --tools list refused; using the older flags', JSON.stringify({ stderr: res.stderr.slice(0, 300) }))
      const again = argsFor(grokPermFlags(mode, { web: getSetting('agent_web_access') !== '0', allowWeb: !!req.allowWeb }))
      res = await this.exec(resumeSessionId ? [...again, '--resume', resumeSessionId] : again, req.cwd)
    }
    if (res.code && req.toolProfile !== 'image' && !this.cancelled) {
      const learned = learnGrokRequirements(`${res.stderr}\n${res.stdout}`)
      if (learned.length) {
        logInfo('[grok] removing tools whose requirements were removed', JSON.stringify(learned))
        const again = argsFor(grokPermFlags(mode, { web: getSetting('agent_web_access') !== '0', allowWeb: !!req.allowWeb }))
        res = await this.exec(resumeSessionId ? [...again, '--resume', resumeSessionId] : again, req.cwd)
      }
    }
    if (raw) logInfo('[grok] raw', JSON.stringify({ code: res.code, stdout: res.stdout.slice(0, 4000), stderr: res.stderr.slice(0, 2000) }))
    if (this.cancelled) { yield { type: 'complete', usage: {} }; return }
    const parsed = parseGrokJson(res.stdout)
    // D-121: grok reports why it stopped; a refused tool call ends the turn silently, which in
    // Collab looked like "Grok says what it will do, then stops without writing anything".
    logInfo('[grok] result', JSON.stringify({ code: res.code, stopReason: parsed?.stopReason ?? null, chars: parsed?.text?.length ?? 0 }))

    // Surface images grok produced this run. Its `imagine` tool saves into grok's own
    // session dir (~/.grok/sessions/<enc-cwd>/<sid>/images) and links them relative
    // ("images/1.jpg"), which doesn't resolve against the project → broken link. Recover
    // those into <cwd>/generated/grok/ and repoint grok's link at the copy; also surface any
    // image grok wrote straight into the project. B-042.
    const failedRun = !!res.code && res.code !== 0
    let cwdImages: string[] = []
    let recovered: RecoveredImage[] = []
    if (!failedRun && req.cwd && !this.cancelled) {
      try {
        // D-087: leave out images another agent wrote in this project meanwhile (a
        // parallel Codex/Claude chat) — they are not grok's output.
        const others = writtenByOthers('grok', imgSince)
        cwdImages = (await newImagesInCwd(req.cwd, imgSince)).filter((f) => !others.has(resolve(f)))
      } catch (e) { logError('[grok] image scan failed', String(e)) }
      // B-049: keep generated/ tidy. Copies go to generated/grok/; a session image grok
      // already saved into the project itself (same byte size) is not copied again, and
      // when grok did write files into the project this turn (it post-processed its own
      // `imagine` output), only the originals its reply actually links are recovered.
      const sizes = new Set<number>()
      for (const f of cwdImages) { try { sizes.add((await fsp.stat(f)).size) } catch { /* skip */ } }
      const recoverOpts = { text: parsed?.text ?? '', skipSizes: sizes, onlyReferenced: cwdImages.length > 0 }
      let scan = { images: [] as RecoveredImage[], baseExists: false, sessionDirs: 0 }
      try { scan = await recoverGrokSessionImages(req.cwd, imgSince, recoverOpts) } catch (e) { logError('[grok] image recovery failed', String(e)) }
      recovered = scan.images
      // grok's `imagine` tool can flush the file a beat after the CLI exits. If the reply
      // clearly references an image ("images/1.jpg") but we found none, re-scan once after
      // a short delay before giving up. Precise: only when an image was actually expected,
      // so plain text turns aren't penalised. (B-044)
      const wantsImage = /(?:images|videos)\/\d+\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v)/i.test(parsed?.text ?? '')
      if (!cwdImages.length && !recovered.length && wantsImage && !this.cancelled) {
        await new Promise((r) => setTimeout(r, 700))
        try { recovered = (await recoverGrokSessionImages(req.cwd, imgSince, recoverOpts)).images } catch (e) { logError('[grok] image recovery retry failed', String(e)) }
        logInfo('[grok] image re-scan after delay', JSON.stringify({ found: recovered.length }))
      }
      logInfo('[grok] image scan', JSON.stringify({ cwd: cwdImages.length, recovered: recovered.length, baseExists: scan.baseExists, sessionDirs: scan.sessionDirs, wantsImage }))
    }
    // Repoint grok's relative "images/<n>" links to the recovered copies so they render
    // inline where grok referenced them; a repointed image needs no separate file_changed.
    let displayText = fixGrokSpacing(parsed?.text ?? '')
    // D-121: which tool was refused — grok's JSON only says "cancelled"; its session log names it.
    const blockedTool = parsed?.stopReason && /cancel/i.test(parsed.stopReason) && req.cwd && parsed.sessionId ? await grokBlockedTool(req.cwd, parsed.sessionId) : null
    if (blockedTool) logInfo('[grok] blocked by a permission prompt', JSON.stringify({ tool: blockedTool, session: parsed?.sessionId }))
    const stopNote = grokStopNote(parsed?.stopReason, mode, blockedTool)
    if (stopNote) displayText = displayText ? `${displayText}\n\n${stopNote}` : stopNote
    const referenced = new Set<string>()
    for (const r of recovered) {
      if (displayText.includes(r.orig)) { displayText = displayText.split(r.orig).join(r.destRel); referenced.add(r.dest) }
    }
    if (referenced.size) displayText = blockifyImages(displayText)
    const emitList = [...cwdImages, ...recovered.filter((r) => !referenced.has(r.dest)).map((r) => r.dest)]
    const emitImages = function* (): Generator<AgentEvent> {
      const seen = new Set<string>()
      for (const f of emitList) { if (seen.has(f)) continue; seen.add(f); if (seen.size > 6) break; yield { type: 'file_changed', path: f } }
    }
    try {
      const text = parsed?.text || (stopNote ? displayText : '')
      const failed = failedRun
      if (text) {
        if (parsed!.sessionId) yield { type: 'session_started', providerSessionId: parsed!.sessionId }
        yield { type: 'text_delta', text: displayText }
        yield* emitImages()
        yield { type: 'complete', usage: { inputTokens: parsed!.inputTokens, outputTokens: parsed!.outputTokens } }
      } else if (failed) {
        // grok prints a stub JSON envelope to stdout even when it fails (e.g. the
        // free-tier rate limit), so the error lives in stderr + a non-zero exit.
        // Surface it regardless of a parsed-but-empty envelope, or it gets swallowed
        // as a blank reply. (B-041)
        const msg = cleanGrokError(res.stderr) || `grok exited with code ${res.code}`
        logInfo('[grok] error', JSON.stringify({ code: res.code, resume: resumeSessionId ?? null, stderr: res.stderr.slice(0, 300) }))
        yield { type: 'error', message: msg, fatal: true }
      } else if (parsed) {
        // Clean exit, valid envelope, genuinely no text.
        if (parsed.sessionId) yield { type: 'session_started', providerSessionId: parsed.sessionId }
        logInfo('[grok] empty result', JSON.stringify({ code: res.code, resume: resumeSessionId ?? null, stderr: res.stderr.slice(0, 300) }))
        yield* emitImages()
        yield { type: 'complete', usage: { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens } }
      } else {
        // Clean exit but no parseable JSON — surface the raw text so a reply isn't lost.
        const rawText = res.stdout.trim()
        if (rawText) yield { type: 'text_delta', text: rawText }
        else yield { type: 'error', message: cleanGrokError(res.stderr) || 'grok returned no output', fatal: true }
        logInfo('[grok] non-JSON output', res.stdout.slice(0, 500))
        yield { type: 'complete', usage: {} }
      }
    } catch (e) {
      logError('[grok] result handling failed', String(e))
      yield { type: 'error', message: String(e), fatal: true }
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    this.proc.cancel()
  }
}

/**
 * D-121: Auto runs grok with --permission-mode acceptEdits — file edits are approved, shell
 * commands are not, and a headless run can't ask, so grok's turn just ends. Say so up front.
 */
export function grokModeRule(mode: string, toolProfile?: string): string {
  if (mode !== 'auto' || toolProfile === 'image') return ''
  return 'Tools in this run: read, create and edit files with your file tools; web search and fetch when web access is on. There is no shell in this mode — use the file tools for everything (no mkdir, cat or ls), and do the whole task in this turn without asking questions.'
}

/**
 * Grok's flags per Troupe permission mode (D-121). A headless grok run cancels ANY tool that
 * asks for permission and ends the turn (session log: permission_requested → resolved
 * "cancelled" in 0–2 ms → turn_ended permission_cancelled). Test 4 lost `write`, test 5
 * `web_fetch`. So every tool a run may use is pre-approved, and every tool that would still
 * ask is removed from its toolset — the model can't call what it doesn't have.
 *  - auto: file edits (Edit covers write + search_replace), web (if on in Settings), MCP.
 *    No shell: grok has no sandbox wired up here, so `run_terminal_command` is removed.
 *  - read: reading only (+ web for a Reviewer); writing tools and shell removed.
 *  - full: always-approve, as before.
 * Never in a headless run: ask_user_question / enter_plan_mode (both wait for a person) and
 * the scheduler (it would create grok-side scheduled jobs).
 */
// D-127: Grok's session logs (2026-10-20) show `--disallowed-tools run_terminal_command` never
// took effect — the shell was offered in every session, and in a Read-only Collab Grok used it and
// stopped at its prompt. So Read-only and Auto name the tools Grok may have (`--tools`, as the image
// profile already does) instead of listing what to remove. Names as Grok reports them.
const GROK_READ_TOOLS = ['read_file', 'list_dir', 'grep', 'todo_write']
const GROK_WRITE_TOOLS = ['write', 'search_replace']
const GROK_MCP_TOOLS = ['search_tool', 'use_tool']
const GROK_IMAGE_TOOLS = ['image_gen', 'image_edit', 'image_to_video', 'reference_to_video']
let grokToolsListUnsupported = false

export function grokPermFlags(mode: string, opts: { web: boolean; allowWeb?: boolean }): string[] {
  if (mode === 'full' || grokToolsListUnsupported) return grokPermFlagsLegacy(mode, opts)
  const web = mode === 'read' ? opts.web && !!opts.allowWeb : opts.web
  const allow = mode === 'read' ? [] : ['Edit', 'MCPTool']
  if (web) allow.push('WebFetch', 'WebSearch')
  const tools = [...GROK_READ_TOOLS, ...(mode === 'read' ? [] : [...GROK_WRITE_TOOLS, ...GROK_MCP_TOOLS, ...GROK_IMAGE_TOOLS]), ...(web ? ['web_fetch'] : [])]
  return ['--permission-mode', mode === 'read' ? 'plan' : 'acceptEdits', ...allow.flatMap((r) => ['--allow', r]), '--tools', tools.join(',')]
}
/** Grok rejected the `--tools` list (an older or newer CLI with other tool names): fall back for the rest of the session. */
export function grokToolsListRejected(output: string): boolean {
  if (grokToolsListUnsupported || !/(--tools|unknown tool|invalid tool|no such tool|not a valid tool)/i.test(output)) return false
  grokToolsListUnsupported = true
  return true
}

/** The D-121 flags: pre-approve, and remove what would still ask (shell removal doesn't hold — see above). */
export function grokPermFlagsLegacy(mode: string, opts: { web: boolean; allowWeb?: boolean }): string[] {
  const never = ['ask_user_question', 'enter_plan_mode', 'scheduler_create', 'scheduler_delete']
  const finish = (remove: string[]) => withGrokDependants(remove).join(',')
  if (mode === 'full') return ['--permission-mode', 'bypassPermissions', '--disallowed-tools', finish(never)]
  const web = mode === 'read' ? opts.web && !!opts.allowWeb : opts.web
  const allow = mode === 'read' ? [] : ['Edit', 'MCPTool']
  if (web) allow.push('WebFetch', 'WebSearch')
  const remove = [...never, 'run_terminal_command', ...(web ? [] : ['web_fetch', 'web_search']),
    ...(mode === 'read' ? ['write', 'search_replace', 'search_tool', 'use_tool', 'image_gen', 'image_edit', 'image_to_video', 'reference_to_video'] : [])]
  return ['--permission-mode', mode === 'read' ? 'plan' : 'acceptEdits', ...allow.flatMap((r) => ['--allow', r]), '--disallowed-tools', finish(remove)]
}

/**
 * Tools that require another tool (D-121, test 6): removing the required one without its
 * dependants makes grok refuse to start ("Requirements unsatisfied"). Grok doesn't publish its
 * requirement graph, so this starts from the pairs it reported and learns the rest from its
 * own error at run time (learnGrokRequirements), for the life of the app.
 */
const GROK_TOOL_DEPENDANTS: Record<string, string[]> = {
  enter_plan_mode: ['exit_plan_mode'],
  scheduler_create: ['scheduler_list', 'scheduler_delete'],
  scheduler_delete: ['scheduler_list']
}
const learnedRemovals = new Set<string>()
/** The removal list plus every tool that requires a removed one (transitively), and learned removals. */
export function withGrokDependants(remove: string[]): string[] {
  const out = new Set([...remove, ...learnedRemovals])
  let grew = true
  while (grew) { grew = false; for (const t of [...out]) for (const d of GROK_TOOL_DEPENDANTS[t] ?? []) if (!out.has(d)) { out.add(d); grew = true } }
  return [...out]
}
/** Parse grok's "Requirements unsatisfied" error; remember each named tool for removal. Returns the new ones. */
export function learnGrokRequirements(text: string): string[] {
  if (!/requirements unsatisfied/i.test(text)) return []
  const found = [...text.matchAll(/tool "(?:[\w-]+:)?([a-z0-9_]+)"\s*:/gi)].map((m) => m[1])
  const fresh = found.filter((t) => !learnedRemovals.has(t))
  for (const t of fresh) learnedRemovals.add(t)
  return fresh
}

/** The tool a cancelled grok turn was asking permission for, from its session log (D-121). */
export async function grokBlockedTool(cwd: string, sessionId: string, home = homedir()): Promise<string | null> {
  try {
    const log = await fsp.readFile(join(home, '.grok', 'sessions', encodeURIComponent(cwd), sessionId, 'events.jsonl'), 'utf8')
    let tool: string | null = null
    for (const line of log.split('\n')) {
      if (!line.includes('permission_resolved')) continue
      try { const e = JSON.parse(line); if (e.type === 'permission_resolved' && e.decision !== 'allow' && typeof e.tool_name === 'string') tool = e.tool_name } catch { /* partial line */ }
    }
    return tool
  } catch { return null }
}

/** A line for the reply when grok stopped for a reason other than finishing (D-121). The
 *  "blocked asking permission" wording is matched by PERMISSION_BLOCKED_RE (collabRecovery). */
export function grokStopNote(stopReason: string | undefined, mode: string, blockedTool?: string | null): string {
  if (!stopReason || /^(end_?turn|stop|completed?|success|done)$/i.test(stopReason)) return ''
  if (blockedTool) return `_Grok was blocked asking permission for \`${blockedTool}\`: a background run can't answer a permission prompt, so the turn ended (\`${stopReason}\`)._`
  if (/permission|cancel|denied|approv/i.test(stopReason)) {
    return `_Grok stopped before finishing (\`${stopReason}\`): a tool it tried needed approval, which Troupe can't give${mode === 'auto' ? ' in Auto (a shell command, or a tool outside file editing)' : mode === 'read' ? ' in Read only' : ''}._`
  }
  if (/max_?turns|turn_?limit/i.test(stopReason)) return `_Grok stopped before finishing (\`${stopReason}\`): it ran out of steps._`
  return `_Grok stopped (\`${stopReason}\`)._`
}

// grok writes multi-line CLI errors to stderr (often prefixed "Error:"); collapse
// to a single readable line for the UI.
function cleanGrokError(stderr: string): string {
  // Signed out: grok's own text ends with a command on the next line, which got cut off.
  if (/not (signed|logged) in|authenticate/i.test(stderr)) return 'Grok isn\'t signed in. Open Settings ▸ Agents ▸ Grok ▸ Sign in…, or run grok once in a terminal.'
  const line = stderr.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => /error|limit|denied|unauthor|forbidden|quota/i.test(l))
    ?? stderr.trim().split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? ''
  return line.replace(/^Error:\s*/i, '').trim()
}

const GROK_IMG_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const GROK_VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i
const GROK_MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v)$/i
// Grok is non-streaming and emits no file events, but with file-write it can write an
// image into the project. Scan the cwd (top level + common output dirs) for images
// created/modified during the run so a real asset renders inline instead of a dangling
// link. (B-042 — Grok has no native image tool; this surfaces whatever it does write.)
function newImagesInCwd(cwd: string, sinceMs: number): Promise<string[]> {
  const dirs = [cwd, join(cwd, 'generated'), join(cwd, 'images'), join(cwd, 'videos'), join(cwd, 'assets'), join(cwd, 'output'), join(cwd, 'out')]
  return mediaFilesSince(dirs, sinceMs, GROK_MEDIA_EXT)
}

// Grok's `imagine` tool saves images inside grok's OWN session dir, not the project:
//   ~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/images/<n>.jpg
// (confirmed from the grok CLI). Grok's reply then links them as a relative path
// ("images/1.jpg") that doesn't resolve against the project cwd → broken link. Recover
// the ones written during this run into <cwd>/generated/grok/ so they render inline. (B-042)
interface RecoveredImage { orig: string; dest: string; destRel: string }
// Recover images grok's `imagine` tool wrote this run. Grok saves them under
// ~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/images/<n>.jpg. We scan ALL
// session dirs for this cwd (not just the reported sessionId) because grok's JSON
// doesn't always return a sessionId, and every turn is a fresh grok session anyway —
// so the reliable signal is "an image under this cwd's sessions, modified during the
// run", not a specific id. Copies land in <cwd>/generated/grok/grok-<sid8>-<n> (unique per
// session; B-043, subfolder B-049). Returns count via out.length for the caller to log. (B-044)
interface RecoverOpts { text: string; skipSizes: Set<number>; onlyReferenced: boolean }
async function recoverGrokSessionImages(cwd: string, sinceMs: number, opts: RecoverOpts = { text: '', skipSizes: new Set(), onlyReferenced: false }): Promise<{ images: RecoveredImage[]; baseExists: boolean; sessionDirs: number }> {
  const base = join(homedir(), '.grok', 'sessions', encodeURIComponent(cwd))
  let dirs: string[]
  try { dirs = await fsp.readdir(base) } catch { return { images: [], baseExists: false, sessionDirs: 0 } }
  // grok saves images under <sid>/images/ and videos under <sid>/videos/, and links them
  // relative ("images/1.jpg", "videos/1.mp4"). Scan both so images AND video are recovered.
  const fresh: { rel: string; f: string; m: number; sid: string; size: number }[] = []
  for (const sd of dirs) {
    for (const sub of ['images', 'videos']) {
      const mediaDir = join(base, sd, sub)
      let names: string[]
      try { names = await fsp.readdir(mediaDir) } catch { continue }
      for (const n of names) {
        if (!GROK_MEDIA_EXT.test(n)) continue
        const f = join(mediaDir, n)
        try {
          const st = await fsp.stat(f)
          if (!st.isFile() || st.mtimeMs <= sinceMs) continue
          const rel = `${sub}/${n}`
          if (opts.skipSizes.has(st.size)) continue // grok already saved this one into the project
          if (opts.onlyReferenced && !opts.text.includes(rel)) continue // intermediate, not linked
          fresh.push({ rel, f, m: st.mtimeMs, sid: sd, size: st.size })
        } catch { /* skip */ }
      }
    }
  }
  if (!fresh.length) return { images: [], baseExists: true, sessionDirs: dirs.length }
  const destDir = join(cwd, 'generated', 'grok')
  try { await fsp.mkdir(destDir, { recursive: true }) } catch { return { images: [], baseExists: true, sessionDirs: dirs.length } }
  const out: RecoveredImage[] = []
  for (const { rel, f, sid } of fresh.sort((a, b) => b.m - a.m).slice(0, 4)) {
    const sidTag = sid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'sess'
    const destName = `grok-${sidTag}-${fileBase(rel)}`
    const dest = join(destDir, destName)
    try { await fsp.copyFile(f, dest); out.push({ orig: rel, dest, destRel: `generated/grok/${destName}` }) } catch { /* skip */ }
  }
  return { images: out, baseExists: true, sessionDirs: dirs.length }
}

// Grok flattens its narration segments (before/after a tool call) into one `text` with
// no separator, so sentences glue: "designer.Generating", "moment.Here". Insert a space
// where sentence punctuation after a lowercase letter is immediately followed by a capital
// (leaves decimals/versions like "1.jpg"/"3.5" alone — they have a digit before the dot). (B-045)
function fixGrokSpacing(text: string): string {
  return text.replace(/([a-z])([.!?:])([A-Z])/g, '$1$2 $3')
}
// Put a recovered image on its own line so it renders as a block between the narration and
// caption instead of jammed inline where grok referenced it. Targets the repointed link. (B-045)
function blockifyImages(text: string): string {
  return text
    .replace(/[ \t]*(!?\[[^\]]*\]\(generated\/grok\/grok-[^)]*\))[ \t]*/g, '\n\n$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface GrokResult { text?: string; sessionId?: string; inputTokens?: number; outputTokens?: number; stopReason?: string }
// grok --output-format json emits { text, stopReason, sessionId, usage } — but be tolerant
// of surrounding log lines by extracting the last JSON object.
function parseGrokJson(out: string): GrokResult | null {
  const tryParse = (t: string): GrokResult | null => {
    try {
      const o = JSON.parse(t)
      if (o && typeof o === 'object') {
        const u = o.usage ?? {}
        return {
          text: typeof o.text === 'string' ? o.text : (typeof o.output === 'string' ? o.output : undefined),
          sessionId: o.sessionId ?? o.session_id,
          stopReason: typeof (o.stopReason ?? o.stop_reason) === 'string' ? (o.stopReason ?? o.stop_reason) : undefined,
          inputTokens: u.input_tokens ?? u.inputTokens ?? u.prompt_tokens,
          outputTokens: u.output_tokens ?? u.outputTokens ?? u.completion_tokens
        }
      }
    } catch { /* not json */ }
    return null
  }
  const whole = tryParse(out.trim())
  if (whole) return whole
  const start = out.indexOf('{'); const end = out.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(out.slice(start, end + 1))
  return null
}
