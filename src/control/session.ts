/**
 * Session-start shapes (ticket 19 / #32): what the control core hands the
 * summon path once an agent's model chain has been resolved.
 *
 * The parameter block is assembled by the publisher (the control core, ticket
 * 19) and consumed by ticket 07's adapter, so it lives next to the other
 * control-domain shapes rather than in a layer either of them would have to
 * reach into. Provenance rides along: the full report leaves with the
 * parameters, and a failed chain leaves as {@link ChainExhaustedError} carrying
 * that same report, so the consumer never re-resolves to explain itself.
 */
import type { AgentDefinition, ChainResolutionReport, ModelRoute, ModelSelectionPolicy } from '../contract/index.ts'

/**
 * The session-start parameters one agent resolved to: the route plus what the
 * engine already took from the document (persona / tool filter / flavor).
 *
 * Every field is the engine's own answer — nothing is re-derived here, so a
 * reader can tell the agent default effort from a chain item's `effort` by
 * `report.effortSource`.
 */
export interface SessionStartParameters {
  /** The route the child Agent is started with. */
  readonly route: ModelRoute
  /** Effective effort (chain item, then agent default, then absent); never invented. */
  readonly reasoningEffort?: string | undefined
  /** The document body: the persona channel (D11). */
  readonly persona: string
  /** Tool names the agent expects; a filter request, never enforcement here (D9). */
  readonly toolFilter: readonly string[]
  /** Effective flavor: call site, then document, then `spawn` (D13). */
  readonly flavor: 'spawn' | 'fork'
  /** Where the effective effort came from (D7). */
  readonly effortSource: ChainResolutionReport['effortSource']
}

/** One prepared agent, chain resolved: parameters plus the full trace. */
export interface ComposedAgentSession {
  readonly ok: true
  readonly agent: AgentDefinition
  /** Which workspace layer the call was resolved against; absent when the project layer was not scanned. */
  readonly cwd?: string | undefined
  readonly parameters: SessionStartParameters
  /** The engine's report: both chain halves, every skip reason, the winner's provenance. */
  readonly report: ChainResolutionReport
}

/** Options of one session-start resolution; every field is per call, never cached. */
export interface ComposeSessionOptions {
  readonly cwd?: string | undefined
  /** Call-site flavor override (D13). */
  readonly flavor?: 'spawn' | 'fork' | undefined
  /** The host setting's allowlist; absent means every route is allowed. */
  readonly policy?: ModelSelectionPolicy | undefined
  /** Caller overrides of per-entry effort (D7); they win over the snapshot's `effort`. */
  readonly itemEffort?: Readonly<Record<string, string | undefined>> | undefined
}
