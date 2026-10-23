/**
 * Session-start wiring for the model chain (ticket 19 / #32): the one place
 * that turns "an agent document + the registry snapshot + what the host
 * allows" into the route a child Agent is started with.
 *
 * The engine ({@link resolveModelChain}, ticket 03) is pure and knows nothing
 * of files, registries or settings; this module is the domain-shaped layer
 * above it, still pure:
 *
 * - it projects the *one* snapshot the caller already read onto the engine's
 *   two optional tables — `itemEffort` from `ModelDefinition.effort` (the
 *   `models:` entry's own column, #31 ruling) and `supportedEfforts` when the
 *   host hands over a capability table. Entries that declare nothing stay out
 *   of the table, so a missing row is never read as "no effort";
 * - a caller's own overrides win over both projections;
 * - it feeds the document (not a copy of the fields this ticket happens to
 *   use) straight through, so persona / tool filter / flavor keep the
 *   engine's own precedence (D11 / D9 / D13);
 * - it never throws and never rewrites a failure: a chain that ran out comes
 *   back as `{ ok: false, code: 'chain-exhausted' }` with the engine's message
 *   and report untouched.
 *
 * Order is the engine's: declaration order per pool, a pool's `degraded`
 * routes behind its `active` ones (R2 §2.6), and no global re-sort across
 * aliases (R2 implementation ruling) — this file adds none.
 */
import { resolveModelChain, type ChainItemEffort, type ChainResolutionContext, type SupportedEfforts } from '../core/index.ts'

import type {
  AliasRegistrySnapshot,
  ChainObservations,
  ChainResolution,
  ChainResolutionInput,
  ModelRoute,
  ModelSelectionPolicy,
} from '../contract/index.ts'

/** The gate a session's allowlist puts on every candidate (spec §5.3-2); absent means every route. */
export type SelectionPolicy = ModelSelectionPolicy

/** The effort capability table, keyed exactly as {@link resolveModelChain} reads it (R2 §2.7-2). */
export type EffortCapabilities = SupportedEfforts

/** One caller's per-model-entry effort override (D7); wins over the snapshot's `effort` column. */
export type ItemEffortOverrides = ChainItemEffort

/** Everything one session-start resolution reads; all of it injected plain data. */
export interface SessionResolutionRequest {
  /** The discovered document as the agent registry handed it out. */
  readonly agent: ChainResolutionInput
  /** The registry snapshot, as read once for this call. */
  readonly snapshot: AliasRegistrySnapshot
  /** Host setting: the allowlist; absent (or `routes` absent) allows every route. */
  readonly policy?: SelectionPolicy | undefined
  /** Call-site flavor override (D13); wins over the document's `spawn`. */
  readonly flavor?: 'spawn' | 'fork' | undefined
  /**
   * Per-model-entry effort overrides from the caller. Merged over the
   * snapshot projection entry by entry, and an explicit `undefined` here
   * removes that entry's projected effort (back to the agent default).
   */
  readonly itemEffort?: ItemEffortOverrides | undefined
  /** Optional capability table; a missing route row is capability-unknown, never a refusal. */
  readonly supportedEfforts?: EffortCapabilities | undefined
  /** Optional failure ledger (R2); absent keeps the report exactly as it was before R2. */
  readonly observations?: ChainObservations | undefined
  /** Clock for the ledger windows (epoch ms); never read from the host here. */
  readonly now?: number | undefined
}

/**
 * Project the snapshot's `models:` entries onto the engine's item-effort table.
 *
 * Only entries that declare an `effort` are written: "no column" is not
 * "effort `undefined`" on purpose, so a caller's override can never fight an
 * invented default and the agent-level default keeps its meaning (D7).
 * Entries are keyed by `modelName`, the key the engine looks a candidate up by.
 * Caller overrides are spread last, entry by entry, so one override never
 * discards the rest of the projection.
 */
export function projectItemEffort(
  snapshot: AliasRegistrySnapshot,
  overrides?: ItemEffortOverrides | undefined,
): ChainItemEffort {
  const projected: Record<string, string> = {}
  for (const entry of snapshot.models) {
    if (entry.effort !== undefined) projected[entry.modelName] = entry.effort
  }
  return overrides === undefined ? projected : { ...projected, ...overrides }
}

/** The engine context minus its two always-injected halves (document, snapshot). */
export type SessionChainContext = Omit<ChainResolutionContext, 'agent' | 'snapshot'>;

/**
 * The engine context one session-start call resolves with: the document and
 * the snapshot the caller read, the policy in force, and the effort table
 * projected from *that same* snapshot.
 *
 * Callers feed the result straight into {@link resolveModelChain}, so the
 * session path can never drift into a second, slightly different call.
 */
export function sessionChainContext(request: SessionResolutionRequest): SessionChainContext {
  return {
    policy: request.policy,
    flavor: request.flavor,
    itemEffort: projectItemEffort(request.snapshot, request.itemEffort),
    supportedEfforts: request.supportedEfforts,
    observations: request.observations,
    now: request.now,
  }
}

/**
 * Whether a route refusal came from the host's allowlist rather than the
 * registry's `available` switch.
 *
 * The engine's hard error is one message for the whole chain (D8) and stays
 * that way; this is the quiet read that lets a host adapter tell a user
 * "your settings forbid this route" from "the registry disabled this model"
 * without re-resolving anything. Keyed by the concrete pair, so it matches
 * what the report shows even for a `raw` candidate.
 */
export function routeNotAllowed(selection: ChainResolution, route: ModelRoute): boolean {
  return selection.report.candidates.some((candidate) =>
    candidate.route?.provider === route.provider
    && candidate.route.model === route.model
    && candidate.skipped === 'not-allowed')
}
