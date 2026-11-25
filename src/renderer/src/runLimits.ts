// The run timeout the live line shows (D-151): Settings ▸ Conversations ▸ "Stop an agent run after
// N minutes without output". Read once, again after Settings is saved.
import { api } from './api'
import { SETTINGS_SAVED_EVENT } from './notices'

let timeoutMin = 15
let loaded = false
function load(): void {
  api.settings.get('run_timeout_min').then((v: string | null) => { const n = Number(v); timeoutMin = v !== null && Number.isFinite(n) && n >= 0 ? n : 15 }).catch(() => undefined)
}
/** Minutes of silence before a chat run is stopped (0 = never). */
export function runTimeoutMin(): number {
  if (!loaded) { loaded = true; load(); window.addEventListener(SETTINGS_SAVED_EVENT, load) }
  return timeoutMin
}
/** The whole run is stopped after this many times the timeout (runner RUN_CEILING). */
export const RUN_CEILING = 4
