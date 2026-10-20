// The agents offered in pickers, @mention autocomplete, Collab and Schedules (D-070):
// the shared catalog minus the agents turned off in Settings ▸ Agents (D-071), each with
// its live install / sign-in status (D-074) so pickers can flag a problem before sending.
import { useSyncExternalStore } from 'react'
import { OS_WORDS } from '../../shared/platform'
import type { ProviderInfo, ProviderId } from '../../shared/types'
import type { ProviderDescriptor } from '../../shared/agent'
import {
  agentEntry, enabledProviderIds, setCustomAgents, serializeDisabledAgents, firstRunAgentsOff,
  DISABLED_AGENTS_SETTING, AGENTS_FIRST_RUN_SETTING
} from '../../shared/providers'
import { parseDisabledModels, serializeDisabledModels, DISABLED_MODELS_SETTING } from '../../shared/models'
import { setDisabledModelsState } from './models'
import { api } from './api'
import { notify } from './notices'
import { WELCOME_DONE_SETTING, shouldShowWelcome } from '../../shared/welcome'
import { catalogEntry, type CustomAgent } from '../../shared/customAgents'

type Status = Partial<Record<ProviderId, { installed: boolean; authenticated: boolean }>>
let status: Status = {}
let disabledRaw: string | null = null
let enabled: ProviderId[] = enabledProviderIds(null)
// User-added agents (2.4): the saved list, registered with the shared catalog.
let custom: CustomAgent[] = []
// Unknown status counts as fine, so nothing is flagged while the check is still running.
const toInfo = (ids: ProviderId[]): ProviderInfo[] =>
  ids.map((id) => ({ id, name: agentEntry(id).label, installed: status[id]?.installed ?? true, authenticated: status[id]?.authenticated ?? true }))

let list: ProviderInfo[] = toInfo(enabled)
const listeners = new Set<() => void>()
const publish = () => { list = toInfo(enabled); for (const l of listeners) l() }
const setEnabled = (ids: ProviderId[]) => { enabled = ids; publish() }

function applyCustomAgents(list: CustomAgent[]): void {
  custom = list
  setCustomAgents(list.map(catalogEntry))
  setEnabled(enabledProviderIds(disabledRaw))   // a new agent appears in pickers; a removed one leaves
}

/** The user-added agents, archived ones included (old messages still need their names). */
export const customAgents = (): CustomAgent[] => custom
export const customAgentFor = (id: ProviderId | null | undefined): CustomAgent | undefined => custom.find((a) => a.id === id)

async function loadCustomAgents(): Promise<void> {
  try { applyCustomAgents(await api.customAgents.list()) } catch { /* none */ }
}
// Main pushes the whole list after every save or remove, to every window.
api?.customAgents?.onChanged?.((list: CustomAgent[]) => { applyCustomAgents(list); void refreshAgentStatus() })

/** Record one agent's fresh status (from agents.check) and update every picker. */
export function setAgentStatus(id: ProviderId, s: { installed: boolean; authenticated: boolean }): Status {
  status = { ...status, [id]: { installed: !!s.installed, authenticated: !!s.authenticated } }
  publish()
  return status
}

/** Ask each CLI whether it is installed and signed in (runs `--version` / auth checks). */
export async function refreshAgentStatus(): Promise<Status> {
  try {
    const all: ProviderDescriptor[] = await api.providers.list()
    status = Object.fromEntries(all.map((p) => [p.id, { installed: !!p.availability.installed, authenticated: !!p.availability.authenticated }]))
    publish()
  } catch { /* keep the last known status */ }
  return status
}

export async function loadAgentSettings(): Promise<void> {
  try {
    const [agents, models, firstDone] = await Promise.all([
      api.settings.get(DISABLED_AGENTS_SETTING), api.settings.get(DISABLED_MODELS_SETTING), api.settings.get(AGENTS_FIRST_RUN_SETTING)
    ])
    setDisabledModelsState(parseDisabledModels(models))
    disabledRaw = agents
    await loadCustomAgents()
    setEnabled(enabledProviderIds(agents))
    const st = await refreshAgentStatus()
    if (!firstDone) await firstRun(st, agents)
  } catch { /* keep everything on */ }
}

// First launch of a fresh install (D-074): switch off agents whose CLI isn't installed, once,
// and say so. Only on a truly new install (no projects yet, agents never configured), so an
// existing user whose CLI is briefly missing never loses a setting.
async function firstRun(st: Status, agentsRaw: string | null): Promise<void> {
  try {
    const projects = await api.projects.list()
    if (projects.length === 0 && agentsRaw === null) {
      const off = firstRunAgentsOff(st)
      // A brand-new user gets the welcome (D-103), which shows each agent's state itself —
      // switch the missing ones off quietly instead of adding a notice on top of it.
      const welcoming = shouldShowWelcome(await api.settings.get(WELCOME_DONE_SETTING), projects.length)
      if (off.length && welcoming) await saveDisabledAgents(off)
      else if (off.length) {
        await saveDisabledAgents(off)
        const names = (ids: ProviderId[]) => { const n = ids.map((id) => agentEntry(id).label); return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] }
        const on = enabledProviderIds(serializeDisabledAgents(off))
        notify(`${names(off)} ${off.length > 1 ? "aren't" : "isn't"} installed on this ${OS_WORDS.computer}, so ${off.length > 1 ? "they're" : "it's"} switched off — you're set up with ${names(on)}. After installing, turn ${off.length > 1 ? 'them' : 'it'} on in Settings ▸ Agents.`)
      }
    }
    await api.settings.set(AGENTS_FIRST_RUN_SETTING, '1')
  } catch { /* try again next launch */ }
}

/** Save which agents are off and update every picker immediately. */
export async function saveDisabledAgents(off: ProviderId[]): Promise<void> {
  const raw = serializeDisabledAgents(off)
  await api.settings.set(DISABLED_AGENTS_SETTING, raw)
  disabledRaw = raw
  setEnabled(enabledProviderIds(raw))
}

/** Save which models are off (D-072); pickers re-render through the agent list. */
export async function saveDisabledModels(keys: Iterable<string>): Promise<void> {
  const raw = serializeDisabledModels(keys)
  await api.settings.set(DISABLED_MODELS_SETTING, raw)
  setDisabledModelsState(parseDisabledModels(raw))
  publish()   // new array → every picker re-renders with the new model list
}

export function useAgentList(): ProviderInfo[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => list)
}
