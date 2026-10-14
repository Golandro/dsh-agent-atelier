/**
 * One agent definition exactly as the registry stores it.
 *
 * Ticket 01 owns discovery, parsing and the error surface for malformed
 * definitions; this container validates nothing and adds no discovery logic.
 */
export interface AgentDefinition {
  /** Stable id the definition is addressed by. */
  readonly id: string
  /** One-line summary shown in lists and pickers. */
  readonly description: string
  /** Discovery root the definition came from, e.g. `workspace:.dsh/agents`. */
  readonly source: string
}

/**
 * The registration point ticket 01 fills and tickets 03/05/06 later consume.
 */
export interface AgentRegistry {
  /** Number of distinct ids currently registered. */
  readonly size: number
  /** Registered definitions in first-registration order. */
  list(): readonly AgentDefinition[]
  /** The definition registered under `id`, if any. */
  get(id: string): AgentDefinition | undefined
  /** Register `definition`; a later definition for the same id replaces it in place. */
  register(definition: AgentDefinition): void
}

/**
 * Create the in-memory definition container. Pure data: no filesystem access,
 * no parsing, no host state.
 */
export function createAgentRegistry(): AgentRegistry {
  const definitions = new Map<string, AgentDefinition>()

  return {
    get size() {
      return definitions.size
    },
    list: () => [...definitions.values()],
    get: (id) => definitions.get(id),
    register: (definition) => {
      definitions.set(definition.id, definition)
    },
  }
}
