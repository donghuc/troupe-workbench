import type { ProviderId } from '../../shared/types'
import type {
  AgentRequest, AgentEvent, ProviderCapabilities, ProviderAvailability
} from '../../shared/agent'

// Core contract every runtime adapter implements. Provider-specific parsing
// lives inside the adapter; the app only ever sees AgentEvents.
export interface AgentProvider {
  readonly id: ProviderId
  readonly name: string

  isAvailable(): Promise<ProviderAvailability>
  getCapabilities(): ProviderCapabilities

  // Streams normalized events. resumeSessionId continues a prior provider session.
  run(req: AgentRequest, resumeSessionId?: string): AsyncIterable<AgentEvent>

  // Cancels the in-flight run for this provider instance (kills the child process in real adapters).
  cancel(): Promise<void>
}
