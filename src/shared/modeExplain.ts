// What a permission mode lets the agent do in this chat, in plain words (D-151 B, "Truthful
// expectations"). Built from the same switches the runs use (Settings ▸ Tools).
import type { PermissionMode } from './agent'

export interface ToolSwitches { web: boolean; shell: boolean; chrome: boolean; sandbox: boolean }

export function explainMode(mode: PermissionMode, s: ToolSwitches): { can: string[]; cannot: string[] } {
  const folders = 'this project’s folders'
  if (mode === 'read') return {
    can: [`Read files in ${folders}`],
    cannot: ['Edit or create files', 'Run commands', 'Use the web']
  }
  if (mode === 'full') return {
    can: ['Edit files anywhere it can reach, not only this project', 'Run any command, with no sandbox', ...(s.web ? ['Search and read the web'] : []), ...(s.chrome ? ['Use your Chrome browser'] : []), 'Use the MCP tools that are switched on'],
    cannot: ['Nothing is blocked — use it only for work you trust']
  }
  return {
    can: [`Edit files in ${folders}`, ...(s.shell ? [s.sandbox ? 'Run commands in a sandbox' : 'Run commands'] : []), ...(s.web ? ['Search and read the web'] : []), ...(s.chrome ? ['Use your Chrome browser'] : []), 'Use the MCP tools that are switched on'],
    cannot: ['Change files outside these folders', ...(s.shell && s.sandbox ? ['Run commands outside the sandbox'] : []), ...(!s.shell ? ['Run commands (off in Settings ▸ Tools)'] : []), ...(!s.web ? ['Use the web (off in Settings ▸ Tools)'] : [])]
  }
}
