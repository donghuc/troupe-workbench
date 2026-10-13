// Push events from agent setup (2.3, Part A): one per output line, then one `done`.
import type { ProviderId } from './types'

export interface SetupEvent {
  runId: string
  agent: ProviderId
  kind: 'install' | 'signIn'
  line?: string
  done?: { ok: boolean; code: number | null; timedOut: boolean; cancelled: boolean; error?: string }
}
