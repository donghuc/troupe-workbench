import { execFileCli } from '../platform/proc'
import { buildContextBlock, withPreamble } from './contextBlock'
import { logInfo, logError } from '../util/logger'
import { getSetting } from '../database/settingsRepo'
import { promises as fsp } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'

// Codex's built-in image_gen tool is model-dependent: the ambiguous exec default
// often lacks it, so image requests silently no-op and Codex confabulates success.
// For image-generation prompts, pin a model known to carry the tool — unless the
// caller already chose a model. Stopgap until the editable Codex model catalog lands.
const DEFAULT_IMAGE_MODEL = 'gpt-5.6-sol' // fallback; overridable in Settings ▸ Agents (codex_image_model)
const IMAGE_NOUN = /\b(images?|pictures?|photos?|photograph|jpe?g|png|webp|illustration|portrait|icon|logo|sprite|wallpaper|artwork|drawing|render|mockup|banner|avatar|sticker|poster|wallpapers?)\b/i
const IMAGE_VERB = /\b(generate|create|make|draw|render|design|produce|paint|illustrate|sketch|imagine)\b/i
function looksLikeImageRequest(text: string): boolean {
  if (!text) return false
  return IMAGE_VERB.test(text) && IMAGE_NOUN.test(text)
}
import { readFileSync } from 'fs'
import { codexDefaultModel, codexServerNames } from '../tools/codexConfig'
import { codexMcpOffArgs } from '../../shared/projectMcp'

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif)$/i
import type { AgentProvider } from './AgentProvider'
import type {
  AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability
} from '../../shared/agent'
import { buildEnv } from './env'
import { CliProcess, mediaFilesSince } from './cliProcess'
import { codexLoggedIn } from './authProbe'

// codex exec --json. No token-level streaming (Phase 0): agent text arrives as a
// whole agent_message item, emitted here as a single text_delta.
function configuredServers(): string[] {
  try { return codexServerNames(readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8')) } catch { return [] }
}
function configuredModel(): string {
  try { return codexDefaultModel(readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8')) } catch { return '' }
}

export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const
  readonly name = 'Codex'
  private proc = new CliProcess()

  isAvailable(): Promise<ProviderAvailability> {
    return new Promise((resolve) => {
      execFileCli('codex', ['--version'], { env: buildEnv() }, (err, verOut) => {
        if (err) { resolve({ installed: false, authenticated: false, detail: 'codex CLI not found on PATH' }); return }
        execFileCli('codex', ['login', 'status'], { env: buildEnv() }, (e, statusOut, statusErr) => {
          const text = `${statusOut}${statusErr}`
          const authed = codexLoggedIn(!!e, text)
          resolve({ installed: true, authenticated: authed, detail: `${String(verOut).trim()} · ${authed ? text.trim().split('\n')[0] : 'Not logged in'}` })
        })
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

  async *run(req: AgentRequest, resumeSessionId?: string): AsyncIterable<AgentEvent> {
    // Codex exec has no system-prompt flag → prepend context as a delimited preamble (D-003).
    // Codex auto-loads AGENTS.md from the cwd, but only a true mirror of the
    // canonical CLAUDE.md counts as delivery — a hand-written or stale AGENTS.md
    // means Codex would otherwise run on different memory than Claude (D-055).
    // Global memory reaches Codex natively only when ~/.codex/AGENTS.md is a true
    // mirror of ~/.claude/CLAUDE.md; otherwise it's injected ahead of project memory (D-055).
    const prompt = withPreamble(buildContextBlock('codex', req), req.prompt)

    // --sandbox is an exec-level flag (not global) so it must precede the `resume`
    // subcommand; --json and --skip-git-repo-check are global and may go anywhere.
    // Permission mode (D-029/D-032) → Codex sandbox/approval. read→read-only,
    // auto→workspace-write. full→--dangerously-bypass-approvals-and-sandbox: this is
    // the ONLY way `codex exec` runs MCP tool calls (e.g. browser tools) — it otherwise
    // forces approval_policy=never and refuses them ("MCP tool call requires approval").
    // That flag also drops the sandbox; it's inherent to the only working workaround.
    const mode = req.permissionMode ?? 'auto'
    const permFlags = mode === 'full'
      ? ['--dangerously-bypass-approvals-and-sandbox']
      : ['--sandbox', mode === 'read' ? 'read-only' : 'workspace-write']
    // Additional folders this run may read and edit (D-054). Codex repeats the flag
    // per directory, and like --sandbox it is exec-level, so it precedes `resume`.
    // Settings ▸ Tools ▸ Web access applies to Codex too (1.5.3): its built-in web search
    // is a config key, overridden per run with -c. On, the user's config.toml decides.
    const webOff = getSetting('agent_web_access') === '0' ? ['-c', 'web_search="disabled"'] : []
    // Reference images (D-088, image canvas): `--image` is exec-level and takes 1+ values,
    // so each goes right after `exec`, where the next `--flag` ends its value list.
    const imageFlags = (req.images ?? []).flatMap((p) => ['--image', p])
    const base = ['exec', ...imageFlags, ...permFlags, ...webOff, ...(req.addDirs ?? []).flatMap((d) => ['--add-dir', d]), ...codexMcpOffArgs(req.mcpOff ?? [], configuredServers()), '--skip-git-repo-check', '--json']   // D-075: project's MCP servers off
    // Pin an image-capable model only for image requests when none was chosen.
    const imageModel = (getSetting('codex_image_model') || '').trim() || DEFAULT_IMAGE_MODEL
    const model = req.model || (looksLikeImageRequest(req.prompt) ? imageModel : '')
    if (model) { base.push('--model', model); if (!req.model) logInfo(`[codex] image request → pinned model ${model}`) }
    // The prompt goes over STDIN (D-060 item 3): `codex exec -` reads it from stdin,
    // which removes the ~1 MiB argv ceiling and keeps the context out of `ps`. The
    // (currently unused) resume path keeps the positional form until verified.
    const args = resumeSessionId
      ? [...base, 'resume', resumeSessionId, prompt]
      : [...base, '-']
    const promptViaStdin = !resumeSessionId

    // Snapshot Codex's image cache so we can recover images the CLI generates but
    // fails to deliver (regression >=0.140.0).
    const genDir = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images')
    const genSince = Date.now() - 1000
    // Codex emits one agent_message item per segment (progress note, correction,
    // final summary). They arrive whole, so join successive ones with a blank line
    // instead of gluing them ("…idol.The first…").
    let sawAgentMsg = false
    let agentText = ''            // to detect if the reply already surfaced an image
    let deliveredImage = false    // set if Codex wrote an image into the project itself
    // codex exec blocks until stdin hits EOF; the runner always closes it (empty on resume).
    yield* this.proc.jsonl({
      bin: 'codex', args, cwd: req.cwd, stdin: promptViaStdin ? prompt : '',
      onRaw: process.env.WB_CODEX_RAW ? (t) => logInfo('[codex:raw] ' + t) : undefined,
      onMapError: (err) => logError('[codex] frame mapping failed', String(err)),
      onJson: (e, push) => {
        const type = e.type
        if (type === 'thread.started') {
          // `codex exec --json` doesn't report its model, so record the one it was run
          // with: the model we passed, else the default in ~/.codex/config.toml (D-073).
          if (e.thread_id) push({ type: 'session_started', providerSessionId: e.thread_id, model: model || configuredModel() || undefined })
        } else if (type === 'turn.started') {
          push({ type: 'status', message: 'Working…' })
        } else if (type === 'item.started' || type === 'item.completed' || type === 'item.updated') {
          const item = e.item ?? {}
          const it = item.type
          // Debug trail for hard-to-see failures (e.g. image generation): record tool/item
          // activity + status/error — not agent message text — to the app log.
          if (it && it !== 'agent_message') logInfo(`[codex] ${type} ${it}${item.status ? ' status=' + item.status : ''}${item.message ? ' msg=' + String(item.message).slice(0, 300) : ''}`)
          if (type === 'item.completed' && it === 'agent_message' && typeof item.text === 'string') {
            push({ type: 'text_delta', text: (sawAgentMsg ? '\n\n' : '') + item.text })
            sawAgentMsg = true
            agentText += item.text
          } else if (it === 'command_execution') {
            if (type === 'item.started') push({ type: 'tool_start', tool: 'shell', input: item.command, itemId: item.id })
            else if (type === 'item.completed') push({ type: 'tool_end', tool: 'shell', isError: item.status === 'failed', itemId: item.id })
          } else if (it === 'file_change' && type === 'item.completed') {
            for (const c of item.changes ?? []) { if (IMG_EXT.test(c.path ?? '')) deliveredImage = true; push({ type: 'file_changed', path: c.path }) }
          } else if (it === 'reasoning' && type === 'item.started') {
            push({ type: 'status', message: 'Thinking…' })
          } else if (it === 'error' && type === 'item.completed') {
            // Phase 0: non-fatal warnings arrive as error-type items — surface as status, don't fail.
            push({ type: 'status', message: `Note: ${item.message ?? 'warning'}` })
          } else if (type === 'item.completed' && item.status === 'failed') {
            // A tool call failed (e.g. image generation) — make it visible instead of letting
            // the model narrate a false success, and log the detail for debugging.
            push({ type: 'status', message: `Tool ${it || 'call'} failed${item.message ? `: ${String(item.message).slice(0, 200)}` : ''}` })
            logError(`[codex] item failed: ${it}`, item.message ?? item)
          }
        } else if (type === 'turn.completed') {
          push({
            type: 'complete',
            // Codex's input_tokens includes the cached part; split it like Claude's so the
            // token line can show how much was served from cache (D-075).
            usage: {
              inputTokens: Math.max(0, (e.usage?.input_tokens ?? 0) - (e.usage?.cached_input_tokens ?? 0)) || undefined,
              cacheReadTokens: e.usage?.cached_input_tokens || undefined,
              outputTokens: e.usage?.output_tokens
            }
          })
        } else if (type === 'turn.failed') {
          logError('[codex] turn.failed', e.error)
          push({ type: 'error', message: e.error?.message ?? 'Turn failed', fatal: true })
        } else if (type === 'error') {
          logError('[codex] error', e.message)
          push({ type: 'error', message: e.message ?? 'Codex error', fatal: true })
        }
      }
    })

    // Workaround for the Codex CLI image-delivery regression: the image is written to
    // CODEX_HOME/generated_images but the CLI often fails to copy it into the project
    // (status stuck at "generating"). If the reply didn't surface an image itself,
    // recover the newest generated image(s) into <cwd>/generated/ and emit them so
    // they render inline like a normally delivered asset.
    // Skip if the reply already surfaced an image (mentions an image file anywhere)
    // or Codex wrote one into the project itself — only recover genuinely undelivered ones.
    if (req.cwd && !deliveredImage && !/\.(png|jpe?g|webp|gif|avif)\b/i.test(agentText)) {
      try {
        const fresh = await mediaFilesSince([genDir], genSince, IMG_EXT, true)   // generated_images/<uuid>/exec-*.png
        if (fresh.length) {
          const destDir = join(req.cwd, 'generated')
          await fsp.mkdir(destDir, { recursive: true })
          for (const src of fresh.slice(0, 4)) {
            const dest = join(destDir, basename(src))
            try {
              await fsp.copyFile(src, dest)
              logInfo(`[codex] recovered undelivered image -> ${dest}`)
              yield { type: 'file_changed', path: dest }
            } catch (e) { logError('[codex] image recovery copy failed', String(e)) }
          }
        }
      } catch (e) { logError('[codex] image recovery scan failed', String(e)) }
    }
  }

  async cancel(): Promise<void> { this.proc.cancel() }
}
