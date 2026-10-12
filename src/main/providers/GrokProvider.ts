import { workFolderRules } from '../../shared/contextBudget'
import { writtenByOthers } from '../agent/recentWrites'
import { execFile } from 'child_process'
import { logInfo, logError } from '../util/logger'
import { promises as fsp } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { AgentProvider } from './AgentProvider'
import type {
  AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability
} from '../../shared/agent'
import { buildEnv } from './env'
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
      execFile('grok', ['--version'], { env: buildEnv() }, (err, verOut, verErr) => {
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
    const block = [ctx?.instructions, globalMemory, memory, ctx?.persistentContext, workFolderRules(req.cwd, req.addDirs), ctx?.skillText, ctx?.snapshot, ctx?.attachmentsText].filter(Boolean).join('\n\n')
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
      : ['--permission-mode', permMode]
    const common = ['-p', prompt, '--output-format', 'json', ...permFlags]
    if (req.model) common.push('-m', req.model)
    const raw = !!process.env.WB_GROK_RAW

    logInfo('[grok] run', JSON.stringify({ model: req.model || 'default', permMode: req.toolProfile === 'image' ? 'image-tools' : permMode, resume: resumeSessionId ?? null }))
    yield { type: 'status', message: 'Working…' }
    const imgSince = Date.now() - 1000

    // The runner injects the transcript each turn and never passes a resume id (by
    // design — see agent/runner.ts), so --resume is effectively unused today; kept as
    // a passthrough for a future Phase-10 native-resume mode. (B-041)
    const res = await this.exec(resumeSessionId ? [...common, '--resume', resumeSessionId] : common, req.cwd)
    if (raw) logInfo('[grok] raw', JSON.stringify({ code: res.code, stdout: res.stdout.slice(0, 4000), stderr: res.stderr.slice(0, 2000) }))
    if (this.cancelled) { yield { type: 'complete', usage: {} }; return }
    const parsed = parseGrokJson(res.stdout)

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
      const text = parsed?.text
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

// grok writes multi-line CLI errors to stderr (often prefixed "Error:"); collapse
// to a single readable line for the UI.
function cleanGrokError(stderr: string): string {
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
    const destName = `grok-${sidTag}-${rel.split('/').pop()}`
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

interface GrokResult { text?: string; sessionId?: string; inputTokens?: number; outputTokens?: number }
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
