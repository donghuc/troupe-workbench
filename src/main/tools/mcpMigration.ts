import { getSetting, setSetting, listSettingsWithPrefix } from '../database/settingsRepo'
import { MCP_OFF_SETTING, LEGACY_PROJECT_MCP_PREFIX, mergeMcpOffLists } from '../../shared/projectMcp'
import { logInfo } from '../util/logger'

// D-077: MCP on/off became global. A server switched off in any project (D-075) starts
// off everywhere — it was switched off because it wasn't wanted. Runs once: only while
// `mcp_off` has never been written. The old keys are left in place (harmless, unread).
export function migrateProjectMcpOff(): void {
  if (getSetting(MCP_OFF_SETTING) !== null) return
  const merged = mergeMcpOffLists(listSettingsWithPrefix(LEGACY_PROJECT_MCP_PREFIX).map((r) => r.value))
  setSetting(MCP_OFF_SETTING, JSON.stringify(merged))
  if (merged.length) logInfo('moved per-project MCP switches to global', { off: merged.length })
}
