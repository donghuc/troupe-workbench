// User-added agents (Troupe 2.4, Part B). A custom agent is any command-line tool that takes
// one prompt, prints a reply and exits. Stored as JSON in the `custom_agents` setting.
// Pure: no electron or node imports, shared by main and the renderer, tested directly.
import type { CustomAgentId } from './types'
import type { CustomCatalogEntry } from './providers'
import { isBuiltinId, BUILTIN_PROVIDERS, BUILTIN_IDS } from './providers'

export const CUSTOM_AGENTS_SETTING = 'custom_agents'

export type CustomOutput = 'text' | 'claude-stream-json'

export interface CustomAgent {
  id: CustomAgentId
  name: string
  handle: string
  /** The command line as typed, e.g. `opencode run {prompt}`. Parsed into bin + args at save time. */
  command: string
  bin: string
  args: string[]
  output: CustomOutput
  /** Flag that picks a model, e.g. `--model`. Empty = the agent has no model picker. */
  modelFlag?: string
  /** Extra arguments added in Read-only mode (e.g. a sandbox flag). Without them read-only is only asked for. */
  readOnlyArgs?: string[]
  /** Set when the agent was added from a bundled preset (Part C). */
  presetId?: string
  /** The user changed the preset's fields; a newer preset doesn't overwrite them. */
  edited?: boolean
  /** Removed by the user: hidden from pickers, but old messages keep its name. */
  archived?: boolean
}

/** Prompts passed as an argument (not stdin) are capped: argv is limited and visible in `ps`. */
export const MAX_ARG_PROMPT = 100 * 1024
const PROMPT_PLACEHOLDER = '{prompt}'
const MODEL_PLACEHOLDER = '{model}'

// ── Command line ─────────────────────────────────────────────────────────────

/**
 * Split a command line the way a shell would split words — single and double quotes,
 * backslash escapes — but nothing else: no variables, globs, pipes or `;`. The result is
 * run directly (never through a shell), so the command can't do more than it shows.
 */
export function parseCommandLine(line: string): { ok: true; argv: string[] } | { ok: false; error: string } {
  const argv: string[] = []
  let cur = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote === "'") { if (c === "'") quote = null; else cur += c; continue }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) cur += line[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue }
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; inWord = true; continue }
    if (/\s/.test(c)) { if (inWord) { argv.push(cur); cur = ''; inWord = false } continue }
    if (/[|;&<>`$]/.test(c)) return { ok: false, error: `Remove “${c}” — the command runs on its own, not in a shell.` }
    cur += c; inWord = true
  }
  if (quote) return { ok: false, error: 'A quote is not closed.' }
  if (inWord) argv.push(cur)
  if (!argv.length) return { ok: false, error: 'Type the command that runs the agent.' }
  return { ok: true, argv }
}

/** Show a parsed argument back to the user (quoted when it has spaces). */
export const showArg = (a: string): string => (/^[\w@%+=:,./{}-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)

export interface RunInput { prompt: string; model?: string; readOnly?: boolean }

/**
 * The arguments and stdin for one run. The prompt replaces `{prompt}` inside one argument
 * (it can never become a flag or a second command); without `{prompt}` it goes to stdin.
 * Throws if an argument prompt is too long.
 */
export function buildRun(agent: Pick<CustomAgent, 'args' | 'modelFlag' | 'readOnlyArgs'>, input: RunInput): { args: string[]; stdin: string } {
  const viaArg = agent.args.some((a) => a.includes(PROMPT_PLACEHOLDER))
  if (viaArg && input.prompt.length > MAX_ARG_PROMPT) {
    throw new Error(`This message and its context are too long to pass on the command line (${Math.round(input.prompt.length / 1024)} KB, limit ${MAX_ARG_PROMPT / 1024} KB). Remove {prompt} from the command if the agent can read the prompt from stdin.`)
  }
  const model = input.model?.trim() ?? ''
  const usesModelSlot = agent.args.some((a) => a.includes(MODEL_PLACEHOLDER))
  const args: string[] = []
  for (const a of agent.args) {
    if (a === MODEL_PLACEHOLDER && !model) continue                    // a bare {model} with no model drops out
    args.push(a.split(PROMPT_PLACEHOLDER).join(input.prompt).split(MODEL_PLACEHOLDER).join(model))
  }
  if (model && !usesModelSlot && agent.modelFlag) args.push(agent.modelFlag, model)
  if (input.readOnly && agent.readOnlyArgs?.length) args.push(...agent.readOnlyArgs)
  return { args, stdin: viaArg ? '' : input.prompt }
}

// ── Output ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>]/g

/** Remove terminal colour/cursor codes and carriage returns (Windows line ends, spinner redraws). */
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '').replace(/\r/g, '')

// ── Names and ids ────────────────────────────────────────────────────────────

/** "Cursor CLI" → "cursor-cli". */
export const handleFromName = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24)

/** A new id for an agent, unique among `taken` (archived agents included, so ids are never reused). */
export function newAgentId(handle: string, taken: string[]): CustomAgentId {
  const base = `x-${handle || 'agent'}`
  let id = base; let n = 2
  while (taken.includes(id)) id = `${base}-${n++}`
  return id as CustomAgentId
}

const RESERVED_HANDLES = new Set(['all', 'debate', 'critique', 'research', 'assistant', 'user', 'troupe'])

export interface CustomAgentDraft {
  name: string; handle: string; command: string; output: CustomOutput; modelFlag?: string; readOnlyArgs?: string; presetId?: string
}

/** Check a draft from the form. Returns the agent to save, or the first problem in plain words. */
export function validateDraft(d: CustomAgentDraft, others: CustomAgent[], id?: CustomAgentId): { ok: true; agent: CustomAgent } | { ok: false; field: 'name' | 'handle' | 'command' | 'readOnlyArgs'; error: string } {
  const name = d.name.trim()
  if (!name) return { ok: false, field: 'name', error: 'Give the agent a name.' }
  if (name.length > 40) return { ok: false, field: 'name', error: 'Keep the name under 40 characters.' }
  const handle = d.handle.trim().replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(handle)) return { ok: false, field: 'handle', error: 'Use lowercase letters, numbers and dashes for the @handle.' }
  const live = others.filter((a) => a.id !== id && !a.archived)
  if (RESERVED_HANDLES.has(handle) || BUILTIN_IDS.some((b) => BUILTIN_PROVIDERS[b].handle === handle) || live.some((a) => a.handle === handle)) {
    return { ok: false, field: 'handle', error: `@${handle} is already taken.` }
  }
  const cmd = parseCommandLine(d.command.trim())
  if (!cmd.ok) return { ok: false, field: 'command', error: cmd.error }
  const [bin, ...args] = cmd.argv
  if (bin.includes(PROMPT_PLACEHOLDER)) return { ok: false, field: 'command', error: 'Start with the program name, e.g. opencode run {prompt}.' }
  let readOnlyArgs: string[] | undefined
  if (d.readOnlyArgs?.trim()) {
    const ro = parseCommandLine(d.readOnlyArgs.trim())
    if (!ro.ok) return { ok: false, field: 'readOnlyArgs', error: ro.error }
    readOnlyArgs = ro.argv
  }
  const agent: CustomAgent = {
    id: id ?? newAgentId(handle, others.map((a) => a.id)),
    name, handle, command: d.command.trim(), bin, args, output: d.output === 'claude-stream-json' ? 'claude-stream-json' : 'text',
    ...(d.modelFlag?.trim() ? { modelFlag: d.modelFlag.trim() } : {}),
    ...(readOnlyArgs ? { readOnlyArgs } : {}),
    ...(d.presetId ? { presetId: d.presetId } : {})
  }
  return { ok: true, agent }
}

/** Back to form fields, for Edit. */
export const draftOf = (a: CustomAgent): CustomAgentDraft => ({
  name: a.name, handle: a.handle, command: a.command, output: a.output, modelFlag: a.modelFlag ?? '', readOnlyArgs: (a.readOnlyArgs ?? []).map(showArg).join(' '), presetId: a.presetId
})

// ── Storage ──────────────────────────────────────────────────────────────────

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Read the setting. Bad JSON → none; a bad entry, or a duplicate id or handle, is skipped. */
export function parseCustomAgents(raw: string | null | undefined): CustomAgent[] {
  let data: unknown
  try { data = JSON.parse(raw || '[]') } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: CustomAgent[] = []
  const handles = new Set(BUILTIN_IDS.map((b) => BUILTIN_PROVIDERS[b].handle))
  for (const e of data as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue
    const { id, name, handle, command, bin, args } = e
    if (typeof id !== 'string' || !/^x-[a-z0-9][a-z0-9-]*$/.test(id) || isBuiltinId(id) || out.some((a) => a.id === id)) continue
    if (typeof name !== 'string' || !name.trim() || typeof handle !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(handle)) continue
    if (typeof command !== 'string' || typeof bin !== 'string' || !bin || !isStrArr(args)) continue
    const archived = e.archived === true
    if (!archived) { if (handles.has(handle)) continue; handles.add(handle) }
    out.push({
      id: id as CustomAgentId, name: name.trim(), handle, command, bin, args,
      output: e.output === 'claude-stream-json' ? 'claude-stream-json' : 'text',
      ...(typeof e.modelFlag === 'string' && e.modelFlag ? { modelFlag: e.modelFlag } : {}),
      ...(isStrArr(e.readOnlyArgs) && e.readOnlyArgs.length ? { readOnlyArgs: e.readOnlyArgs } : {}),
      ...(typeof e.presetId === 'string' ? { presetId: e.presetId } : {}),
      ...(e.edited === true ? { edited: true } : {}),
      ...(archived ? { archived: true } : {})
    })
  }
  return out
}

export const serializeCustomAgents = (list: CustomAgent[]): string => JSON.stringify(list)

/** The catalog entry the rest of the app reads through agentEntry(). */
export const catalogEntry = (a: CustomAgent): CustomCatalogEntry => ({
  id: a.id, label: a.name, handle: a.handle, cli: a.bin, strongModel: '', memoryFile: null, globalMemoryPath: null, builtinTools: [], ...(a.archived ? { archived: true } : {})
})

// ── Test run ─────────────────────────────────────────────────────────────────
export const TEST_PROMPT = 'Reply with exactly: Troupe test OK'
export const TEST_TIMEOUT_MS = 60_000
export interface TestResult { ok: boolean; reply: string; error?: string; ms: number }
