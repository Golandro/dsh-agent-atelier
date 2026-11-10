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
import type { AgentDefinition, ChainObservations, ChainResolutionReport, ModelDefinition, ModelRoute, ModelSelectionPolicy } from '../contract/index.ts'

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
  /**
   * The winning registry entry when an alias target won (ticket 04): its
   * `sysPrompt` is the per-model system section. Absent when a raw `model:`
   * pair won, so assembly never invents a registry entry.
   */
  readonly model?: ModelDefinition | undefined
}

/**
 * Options of {@link ControlCore.chainReport} (ticket 58): the session-start
 * inputs, plus the wire's scope rule where `null` means user-global.
 */
export interface ChainReportOptions extends Omit<ComposeSessionOptions, 'cwd'> {
  /** `null` asks for user-global (no project layer), exactly like the wire's `cwd`. */
  readonly cwd?: string | null | undefined
}

/**
 * One agent's chain resolution as the on-demand read face returns it (ticket
 * 58): the engine's report, untouched, plus the one bit the session path would
 * turn into a throw. Read from the same document/snapshot/engine call as
 * {@link ControlCore.composeSession}, so the two can never disagree.
 */
export interface AgentChainReport {
  /** The engine's report: both chain halves, every skip reason, the winner's provenance. */
  readonly report: ChainResolutionReport
  /** True when the chain ran out; the session path throws `chain-exhausted` for the same answer. */
  readonly exhausted: boolean
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
  /**
   * The runtime failure ledger (07b / #56), as the caller's recorder currently
   * reads it. Absent means "no ledger": the report keeps its pre-R2 shape.
   */
  readonly observations?: ChainObservations | undefined
  /** Clock for the ledger windows (epoch ms); only read when `observations` is present. */
  readonly now?: number | undefined
}
