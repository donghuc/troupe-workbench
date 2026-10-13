// User-added agents (2.4): load, save, remove (archive) and test. The list lives in the
// `custom_agents` setting; every change re-registers the catalog and tells the windows.
import { BrowserWindow } from 'electron'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSetting, setSetting } from '../database/settingsRepo'
import { setCustomAgents } from '../../shared/providers'
import {
  CUSTOM_AGENTS_SETTING, parseCustomAgents, serializeCustomAgents, validateDraft, catalogEntry,
  TEST_PROMPT, TEST_TIMEOUT_MS, type CustomAgent, type CustomAgentDraft, type TestResult
} from '../../shared/customAgents'
import type { CustomAgentId } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { CustomCliProvider, whichBin } from '../providers/CustomCliProvider'
import { PRESET_RECIPES } from '../../shared/agentRecipes'
import { resetLoginPath, buildEnv } from '../providers/env'
import { removeTempDir } from '../util/tempFiles'
import { logInfo } from '../util/logger'

let agents: CustomAgent[] = []

/** Read the setting and register the agents with the catalog. Call once at startup, after the DB opens. */
export function loadCustomAgents(): CustomAgent[] {
  agents = parseCustomAgents(getSetting(CUSTOM_AGENTS_SETTING))
  setCustomAgents(agents.map(catalogEntry))
  return agents
}

export const listCustomAgents = (): CustomAgent[] => agents
export const getCustomAgent = (id: string): CustomAgent | undefined => agents.find((a) => a.id === id)

function commit(next: CustomAgent[]): CustomAgent[] {
  setSetting(CUSTOM_AGENTS_SETTING, serializeCustomAgents(next))
  loadCustomAgents()
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(IPC.customAgentsChanged, agents) }
  return agents
}

/** Add (no id) or update an agent from the form. Throws the form's error in plain words. */
export function saveCustomAgent(draft: CustomAgentDraft, id?: CustomAgentId): CustomAgent {
  const prev = id ? getCustomAgent(id) : undefined
  if (id && !prev) throw new Error('That agent no longer exists.')
  const r = validateDraft(draft, agents, id)
  if (!r.ok) throw new Error(r.error)
  const agent: CustomAgent = { ...r.agent, ...(prev?.presetId ? { presetId: prev.presetId, edited: true } : {}) }
  commit(prev ? agents.map((a) => (a.id === id ? agent : a)) : [...agents, agent])
  logInfo('[custom] saved', JSON.stringify({ id: agent.id, bin: agent.bin, output: agent.output }))
  return agent
}

/** Remove = archive: gone from pickers and @-mentions, but old messages keep the name. */
export function removeCustomAgent(id: CustomAgentId): void {
  commit(agents.map((a) => (a.id === id ? { ...a, archived: true } : a)))
}

/** Run a draft once in an empty temp folder with a fixed prompt. Never touches a project. */
export async function testCustomAgent(draft: CustomAgentDraft, id?: CustomAgentId): Promise<TestResult> {
  const started = Date.now()
  const r = validateDraft(draft, agents, id)
  if (!r.ok) return { ok: false, reply: '', error: r.error, ms: 0 }
  const dir = mkdtempSync(join(tmpdir(), 'workbench-ctx-test-'))
  const provider = new CustomCliProvider(r.agent, TEST_TIMEOUT_MS)
  let reply = ''
  let error: string | undefined
  try {
    for await (const ev of provider.run({ prompt: TEST_PROMPT, context: {}, cwd: dir, permissionMode: 'read' })) {
      if (ev.type === 'text_delta') reply += ev.text
      else if (ev.type === 'error') error = ev.message
    }
  } catch (err) {
    error = (err as Error).message
  } finally {
    removeTempDir(dir)
  }
  reply = reply.trim()
  if (!error && !reply) error = 'It finished without printing a reply'
  logInfo('[custom] test', JSON.stringify({ bin: r.agent.bin, ok: !error, ms: Date.now() - started }))
  return { ok: !error, reply: reply.slice(0, 2000), ...(error ? { error } : {}), ms: Date.now() - started }
}

/** Which bundled presets are installed on this Mac: the first of their binaries found on PATH (no execution). */
export function detectPresets(): { id: string; found: string | null }[] {
  resetLoginPath()   // pick up a CLI installed while Troupe is open
  const env = buildEnv()
  return PRESET_RECIPES.map((r) => ({ id: r.id, found: r.detect.find((b) => whichBin(b, env)) ?? null }))
}
