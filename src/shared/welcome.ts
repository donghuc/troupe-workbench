// First-run welcome (D-103): the three-screen setup a brand-new user sees once. Pure rules
// only — the screens live in renderer/src/components/Welcome.tsx.
import { BUILTIN_IDS } from './providers'
import { IS_WINDOWS, fileBase } from './platform'
import type { ProviderId } from './types'

/** Set once the welcome has been finished or skipped; never shown again automatically. */
export const WELCOME_DONE_SETTING = 'welcome_done'
/** Window event that re-opens the welcome (Settings ▸ About ▸ Show welcome). */
export const SHOW_WELCOME_EVENT = 'troupe:show-welcome'

/** New users only: nothing configured yet and no projects. Existing users never see it. */
export function shouldShowWelcome(doneRaw: string | null, projectCount: number): boolean {
  return !doneRaw && projectCount === 0
}

export type AgentState = 'checking' | 'ready' | 'signin' | 'missing'
export type AgentStatus = Partial<Record<ProviderId, { installed: boolean; authenticated: boolean }>>

export function agentState(s: { installed: boolean; authenticated: boolean } | undefined): AgentState {
  if (!s) return 'checking'
  if (!s.installed) return 'missing'
  return s.authenticated ? 'ready' : 'signin'
}

/** Ready agents in display order. Grok and Gemini have no sign-in probe, so installed counts as ready. */
export function readyAgents(status: AgentStatus): ProviderId[] {
  return BUILTIN_IDS.filter((id) => agentState(status[id]) === 'ready')
}

/**
 * Agents to switch off when the welcome's first screen is passed: everything not ready
 * (missing or signed out), so @all and pickers only offer agents that can answer. Never
 * all of them, and nothing while any check is still running.
 */
export function welcomeAgentsOff(status: AgentStatus): ProviderId[] {
  if (BUILTIN_IDS.some((id) => !status[id])) return []
  const ready = readyAgents(status)
  return ready.length ? BUILTIN_IDS.filter((id) => !ready.includes(id)) : []
}

/**
 * Picking a whole home, Desktop, Documents or Downloads folder lets agents edit everything
 * in it — warn (not block) and suggest a subfolder.
 */
export function isBroadFolder(path: string): boolean {
  const p = path.replace(/\/+$/, '')
  if (IS_WINDOWS && /^[a-z]:\\(users(\\[^\\]+(\\(desktop|documents|downloads))?)?)?\\?$/i.test(p.replace(/\//g, '\\'))) return true
  return /^\/Users\/[^/]+(\/(Desktop|Documents|Downloads))?$/.test(p) || p === '' || p === '/Users'
}

/** Project name from a folder path: its last segment. */
export function nameFromFolder(path: string): string {
  return fileBase(path.replace(IS_WINDOWS ? /[\\/]+$/ : /\/+$/, '')) || 'My project'
}

/**
 * The one-click first prompt. Two or more ready agents → @all (independent answers, then a
 * Compare card); one → a plain prompt to that agent. Runs read-only either way.
 */
export function welcomePrompt(ready: ProviderId[], hasFolder: boolean): { text: string; provider: ProviderId; compare: boolean } | null {
  if (!ready.length) return null
  const ask = hasFolder
    ? 'In three bullets: what is this project about, and what looks unfinished?'
    : 'Give me three different plans for a two-day team offsite, each in three bullets.'
  return ready.length > 1
    ? { text: `@all ${ask}`, provider: ready[0], compare: true }
    : { text: ask, provider: ready[0], compare: false }
}
