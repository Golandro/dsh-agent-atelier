/**
 * The in-memory definition container behind the registry service.
 *
 * Ticket 01 keeps this as the internal storage of a scan: pure data, no
 * filesystem access, no parsing, no host state. Discovery does the validating
 * and rank-deciding, then hands finished definitions to `register()`; the
 * service wraps it with the lazy per-project-root memoisation.
 *
 * `createAgentRegistry` (this container) is deliberately distinct from
 * `createAgentRegistryService` (the `ctx.agentRegistry` service in
 * `./discovery.ts`): the container keeps its synchronous `size`/`register`
 * surface for focused unit tests, while the service face is the frozen
 * `AgentRegistry` contract and has no `size`.
 */
import type { AgentDefinition } from './types.ts'

/**
 * Storage for discovered definitions, addressable by agent name.
 */
export interface AgentDefinitionContainer {
  /** Number of distinct agent names currently held. */
  readonly size: number
  /** Held definitions in first-registration order. */
  list(): readonly AgentDefinition[]
  /** The definition registered under `agentName`, if any. */
  get(agentName: string): AgentDefinition | undefined
  /** Store `definition`; a later definition for the same agent name replaces it in place. */
  register(definition: AgentDefinition): void
}

/**
 * Create the definition container. Pure data: no filesystem access, no parsing,
 * no host state.
 */
export function createAgentRegistry(): AgentDefinitionContainer {
  const definitions = new Map<string, AgentDefinition>()

  return {
    get size() {
      return definitions.size
    },
    list: () => [...definitions.values()],
    get: (agentName) => definitions.get(agentName),
    register: (definition) => {
      definitions.set(definition.agentName, definition)
    },
  }
}
