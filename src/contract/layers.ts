/**
 * Discovery-root precedence: the one rank table of the bundle (簇 F).
 *
 * Host provider registration reads these numbers, the list query evaluator
 * sorts by them, and the client list's layer column derives its value from
 * them — one table instead of one per consumer. Values stay data, not logic:
 * this module only exports the literal map, consumers do the lookup.
 *
 * Lower rank wins. The gaps leave room for the reserved v2 custom slot (300)
 * between `project-agents` and `user-dsh`; `bundled` is the host's own last
 * resort, exactly what the declaration order of {@link AgentSource} says.
 */
import type { AgentSource } from './types.ts'

/** Rank of every discovery root; lower wins, and no two roots share a rank. */
export const AGENT_SOURCE_RANK: Readonly<Record<AgentSource, number>> = {
  'project-dsh': 100,
  'project-agents': 200,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600,
}
