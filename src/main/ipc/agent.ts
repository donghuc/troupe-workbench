import { handle } from './handle'
import { describeProviders } from '../providers/registry'
import { resetLoginPath } from '../providers/env'
import { startSetup, cancelSetup, checkAgent } from '../agents/setupService'
import { listCustomAgents, saveCustomAgent, removeCustomAgent, testCustomAgent, detectPresets } from '../agents/customAgentStore'
import { maybeCompress } from '../agent/snapshotService'
import { startTurn, regenerateTurn, cancelTurn, getTurnState, snapshotTurns, compareTurn } from '../agent/turns'
import type { StartTurnInput, RegenerateInput } from '../../shared/turns'

export function registerAgentIpc(): void {
  // Re-read the login-shell PATH on every check, so a CLI installed while Troupe is open is found (D-103 Re-check).
  handle('providers.list', () => { resetLoginPath(); return describeProviders() })
  // Agent setup (2.3, Part A).
  handle('agents.setupStart', (e, id, kind, terminal) => startSetup(e.sender, id, kind, terminal))
  handle('agents.setupCancel', (_e, runId) => cancelSetup(runId))
  handle('agents.check', (_e, id, fresh) => checkAgent(id, fresh))
  // User-added agents (2.4, Part B).
  handle('customAgents.list', () => listCustomAgents())
  handle('customAgents.save', (_e, draft, id) => saveCustomAgent(draft, id))
  handle('customAgents.remove', (_e, id) => removeCustomAgent(id))
  handle('customAgents.test', (_e, draft, id) => testCustomAgent(draft, id))
  handle('customAgents.presets', () => detectPresets())
  handle('conversations.compressNow', (e, conversationId: string) => maybeCompress(conversationId, e.sender, true))
  // Turn orchestration (D-061): the renderer sends messages here; there is no direct run request (D-099).
  handle('turns.start', (e, input: StartTurnInput) => startTurn(e.sender, input))
  handle('turns.regenerate', (e, input: RegenerateInput) => regenerateTurn(e.sender, input))
  handle('turns.cancel', (_e, conversationId: string) => cancelTurn(conversationId))
  handle('turns.compare', (e, conversationId: string) => compareTurn(e.sender, conversationId))
  handle('turns.get', (_e, conversationId: string) => getTurnState(conversationId))
  handle('turns.snapshot', () => snapshotTurns())
}
