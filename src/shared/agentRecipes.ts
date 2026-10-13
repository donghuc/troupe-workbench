// Agent recipes (Troupe 2.3, Part A): how to install and sign in to each agent, one JSON file
// per agent in src/shared/agents/. Bundled by import, so they ship inside the app (the
// packaged allow-list only includes out/ — D-089). Setup data only: the built-in agents'
// runners stay as code. Pure; tested.
import type { ProviderId, BuiltinProviderId } from './types'
import { parseCommandLine, type CustomOutput } from './customAgents'
import claude from './agents/claude-code.json'
import codex from './agents/codex.json'
import gemini from './agents/gemini.json'
import grok from './agents/grok.json'
import opencode from './agents/opencode.json'
import cursor from './agents/cursor.json'

export interface AgentRecipe {
  id: string
  label: string
  recommended?: boolean
  /** Binaries to look for on the merged PATH (no execution). */
  detect: string[]
  /** One plain-language line: the plan or account the agent needs. */
  needs?: string
  /** Something to install first (none of today's built-ins need one). */
  prereq?: 'node' | null
  /** Absent → no install from Troupe; the card links to `docs`. `host` is shown before running. */
  install?: { cmd: string; host: string; manualOnly?: boolean }
  /** `terminal: true` = interactive-only, always opened in a Terminal window. */
  signIn?: { cmd: string; terminal?: boolean }
  docs?: string
  /** Presets only (2.4, Part C): how to run it as a user-added agent. Built-ins leave it out. */
  agent?: { command: string; output: CustomOutput; modelFlag?: string; readOnlyArgs?: string }
}

export type RecipeResult = { ok: true; recipe: AgentRecipe } | { ok: false; reason: string }

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const BIN_RE = /^[A-Za-z0-9._-]+$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** Validate one recipe. Never throws: a bad recipe comes back with the reason. */
export function parseAgentRecipe(raw: unknown): RecipeResult {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' }
  const { id, label, recommended, detect, needs, prereq, install, signIn, docs, agent } = raw
  if (!isStr(id) || !ID_RE.test(id)) return { ok: false, reason: 'id must be lowercase letters, digits and dashes' }
  if (!isStr(label)) return { ok: false, reason: `${id}: label is required` }
  if (!Array.isArray(detect) || !detect.length || !detect.every((b) => isStr(b) && BIN_RE.test(b))) return { ok: false, reason: `${id}: detect must list binary names` }
  if (needs !== undefined && !isStr(needs)) return { ok: false, reason: `${id}: needs must be text` }
  if (prereq !== undefined && prereq !== null && prereq !== 'node') return { ok: false, reason: `${id}: prereq must be "node" or null` }
  if (recommended !== undefined && typeof recommended !== 'boolean') return { ok: false, reason: `${id}: recommended must be true/false` }
  let inst: AgentRecipe['install']
  if (install !== undefined) {
    if (!isObj(install) || !isStr(install.cmd) || !isStr(install.host)) return { ok: false, reason: `${id}: install needs cmd and host` }
    if (!HOST_RE.test(install.host)) return { ok: false, reason: `${id}: install.host must be a host name` }
    if (/\bsudo\b/.test(install.cmd)) return { ok: false, reason: `${id}: install must not use sudo (mark it manualOnly)` }
    // The command must download from the host it names, so the confirm step tells the truth.
    const urls = install.cmd.match(/https?:\/\/[^\s'"|]+/g) ?? []
    if (urls.some((u) => { try { return new URL(u).hostname !== install.host } catch { return true } })) return { ok: false, reason: `${id}: install downloads from a host other than ${install.host}` }
    inst = { cmd: install.cmd.trim(), host: install.host, ...(install.manualOnly === true ? { manualOnly: true } : {}) }
  }
  let sign: AgentRecipe['signIn']
  if (signIn !== undefined) {
    if (!isObj(signIn) || !isStr(signIn.cmd)) return { ok: false, reason: `${id}: signIn needs cmd` }
    sign = { cmd: signIn.cmd.trim(), ...(signIn.terminal === true ? { terminal: true } : {}) }
  }
  if (docs !== undefined && !(isStr(docs) && /^https:\/\//.test(docs))) return { ok: false, reason: `${id}: docs must be an https link` }
  if (!inst && !docs) return { ok: false, reason: `${id}: needs an install command or a docs link` }
  let run: AgentRecipe['agent']
  if (agent !== undefined) {
    if (!isObj(agent) || !isStr(agent.command) || !parseCommandLine(agent.command).ok) return { ok: false, reason: `${id}: agent.command must be a command line` }
    if (agent.output !== undefined && agent.output !== 'text' && agent.output !== 'claude-stream-json') return { ok: false, reason: `${id}: agent.output must be "text" or "claude-stream-json"` }
    if (agent.modelFlag !== undefined && !isStr(agent.modelFlag)) return { ok: false, reason: `${id}: agent.modelFlag must be text` }
    if (agent.readOnlyArgs !== undefined && !(isStr(agent.readOnlyArgs) && parseCommandLine(agent.readOnlyArgs).ok)) return { ok: false, reason: `${id}: agent.readOnlyArgs must be arguments` }
    run = {
      command: agent.command.trim(), output: agent.output === 'claude-stream-json' ? 'claude-stream-json' : 'text',
      ...(agent.modelFlag ? { modelFlag: (agent.modelFlag as string).trim() } : {}),
      ...(agent.readOnlyArgs ? { readOnlyArgs: (agent.readOnlyArgs as string).trim() } : {})
    }
  }
  return {
    ok: true,
    recipe: {
      id, label: label.trim(), detect: detect as string[],
      ...(recommended ? { recommended: true } : {}),
      ...(needs ? { needs: (needs as string).trim() } : {}),
      ...(prereq ? { prereq } : {}),
      ...(inst ? { install: inst } : {}),
      ...(sign ? { signIn: sign } : {}),
      ...(docs ? { docs: docs as string } : {}),
      ...(run ? { agent: run } : {})
    }
  }
}

/** Settings key: which recipe versions the user has confirmed (id → recipeHash). */
export const SETUP_CONFIRMED_SETTING = 'agent_setup_confirmed'

/** A short fingerprint of what a confirm covers (the install command and its host). A recipe change asks again. */
export function recipeHash(r: AgentRecipe): string {
  const s = JSON.stringify([r.install?.cmd ?? '', r.install?.host ?? ''])
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Every bundled recipe file, by file name — a test checks this matches the folder. */
export const RECIPE_FILES: Record<string, unknown> = {
  'claude-code.json': claude, 'codex.json': codex, 'gemini.json': gemini, 'grok.json': grok,
  'opencode.json': opencode, 'cursor.json': cursor
}

function load(raw: unknown): AgentRecipe {
  const r = parseAgentRecipe(raw)
  if (!r.ok) throw new Error(`bad agent recipe: ${r.reason}`)
  return r.recipe
}

/** Setup recipes for the built-in agents. */
export const BUILTIN_RECIPES: Record<BuiltinProviderId, AgentRecipe> = {
  'claude-code': load(claude), codex: load(codex), gemini: load(gemini), grok: load(grok)
}

/**
 * Ready-made user-added agents (2.4, Part C). Before shipping a change, check the CLI's
 * current --help: binary name, non-interactive flag, model flag, read-only flag, install URL.
 */
export const PRESET_RECIPES: AgentRecipe[] = [load(opencode), load(cursor)]
export const presetRecipe = (id: string): AgentRecipe | undefined => PRESET_RECIPES.find((r) => r.id === id)
