/**
 * The model chain resolution engine (ticket 03, spec §5.3): pure functions that
 * turn an agent document plus a registry snapshot into the route a child Agent
 * is started with, or into a hard error carried as data (D8).
 *
 * Both chain sources converge here (2026-10-20 residual K): `modelOrder`
 * expands each alias to its model entries and the legacy `model:` array
 * contributes its entries, but both become the *same* candidate record in one
 * list, and one pipeline steps over that list — availability, allowlist, first
 * survivor — in declaration order. `origin` rides along as provenance only, so
 * the report can say "this ran through the escape hatch" (D5/§8) without the
 * resolution logic ever forking per source.
 *
 * Semantics checked against the DSH sources rather than the ticket's line
 * numbers:
 * - the allowlist is `ModelSelectionPolicy.routes` and the refusal is exactly
 *   "the route is not in the list" (`tool-subagent`'s `model-selection.ts`);
 *   it has no availability notion of its own, so `available: false` is the
 *   registry layer's switch (D6), and spec §5.3-2 makes both refusals one skip
 *   class in the report ("全链被拦 ⇒ 与不可用同等处理");
 * - DSH throws at the call site and the tool turns that into `isError`; the
 *   same philosophy here is an `{ ok: false }` result whose message echoes the
 *   whole chain, so the summon tool (07) only has to re-throw it;
 * - DSH's policy skips "pure inheritance" (no model-facing choice was made).
 *   An agent document is *always* an explicit choice, so the allowlist applies
 *   to every candidate here — a deliberate reading, flagged in the ticket's
 *   drift notes.
 *
 * Pure and I/O-free by construction: the document, the registry snapshot and
 * the selection policy are injected plain data, the shape
 * `inspectAliasRegistry` in `./catalog/alias-registry.ts` already froze for
 * ticket 02. Nothing here reads a file, the environment or the host context.
 *
 * Ticket 03 enhancement (R2): two more optional injected inputs turn the same
 * pipeline runtime-aware without giving it any state of its own —
 * `observations` + `now` (the failure ledger, projected by `./observations.ts`)
 * demote `degraded` routes to the back of their pool, and `supportedEfforts`
 * lets a route that cannot run the required effort be skipped instead of
 * failing DSH's preflight. Both default to absent, and absent means "behave
 * exactly as before": no clock, no ledger, no capability table, same report.
 */
import type {
  AliasChainStep,
  AliasRegistrySnapshot,
  ChainCandidateReport,
  ChainObservations,
  ChainResolution,
  ChainResolutionFailure,
  ChainResolutionInput,
  ChainResolutionReport,
  ChainSkipReason,
  EffortSource,
  ModelDefinition,
  ModelRoute,
  ModelSelectionPolicy,
  RouteHealth,
} from '../../contract/index.ts'
import { routeKey, withAvailability } from './observations.ts'

/**
 * Per-model-entry effort overrides, keyed by registry model name (D7's "链项
 * 自带"). Since R1/#35 a `models:` entry does declare an `effort` column
 * (`ModelDefinition.effort`, #31 ruling), so the table is the *projection* of
 * that column, assembled by whoever owns the snapshot (ticket 19's
 * `src/control/resolve.ts`); a caller's override wins for the entries it names.
 * The engine still reads only the table it is handed — it never opens the
 * snapshot itself — and when neither the table nor the document names an
 * effort, the agent-level default is used, exactly as the spec spells it out.
 */
export type ChainItemEffort = Readonly<Record<string, string | undefined>>

/**
 * The injected effort capability table (R2 §2.7-2): which `reasoningEffort`
 * values each **route** supports, keyed by `routeKeyOf(route)` — the exact
 * `provider/model` pair DSH's `resolveCallConfig` looks capability up by, so
 * per-provider lines of the same model id stay distinct. Whoever records the
 * table (07, from `ctx.llm`) builds the key with the same function, so the two
 * sides cannot drift on the encoding.
 *
 * A route **absent from the table is unknown, not unsupported**: no entry means
 * "not judged", exactly like passing no table at all. An entry that exists and
 * does not list the effective effort is a refusal — the route is skipped as
 * `'unsupported-effort'` instead of dying in DSH's preflight
 * (`UNSUPPORTED_REASONING_EFFORT`, thrown before the child exists). The engine
 * never rewrites the effort to make a route fit: that would change the
 * semantics the author asked for.
 */
export type SupportedEfforts = Readonly<Record<string, readonly string[] | undefined>>

/**
 * One candidate in the engine's single internal pipeline.
 *
 * Alias expansion and the raw fallback both produce these records; every step
 * after construction is source-blind.
 */
interface ChainCandidate {
  /** Provenance only: nothing in the engine branches on it. */
  readonly origin: 'alias' | 'raw'
  /** `modelOrder` position for alias candidates; absent for raw ones. */
  readonly orderIndex?: number | undefined
  /** Registry model entry name; absent for raw candidates and unknown targets. */
  readonly modelName?: string | undefined
  /** Exact route; known from the entry (alias) or the reference (raw). */
  readonly route?: ModelRoute | undefined
  /** Why this candidate cannot win, or that the chain stopped first; `undefined` on the winner. */
  readonly skipped?: Reason | undefined
  /** Runtime health of its route; `undefined` when no ledger was injected (reads as active). */
  readonly health?: RouteHealth | undefined
}

/** A skip reason, plus the honest "the chain stopped before reaching you". */
type Reason = ChainSkipReason | 'not-reached'

/** One resolution context: what the document names plus the injected tables. */
export interface ChainResolutionContext {
  readonly agent: ChainResolutionInput
  readonly snapshot: AliasRegistrySnapshot
  /** The session's allowlist; absent means every route is allowed. */
  readonly policy?: ModelSelectionPolicy | undefined
  /** Call-site flavor override (D13); wins over the document's `spawn`. */
  readonly flavor?: 'spawn' | 'fork' | undefined
  /** Optional per-model-entry effort overrides (D7). */
  readonly itemEffort?: ChainItemEffort | undefined
  /** Optional failure ledger (R2): demotes `degraded` routes within their pool. */
  readonly observations?: ChainObservations | undefined
  /** Clock for the ledger's windows, epoch ms (R2); never read from the host here. */
  readonly now?: number | undefined
  /** Optional effort capability table (R2 §2.7-2); absent means no judge. */
  readonly supportedEfforts?: SupportedEfforts | undefined
}

/** The allowlist decision, DSH-shaped: no policy ⇒ allowed; otherwise an exact route match. */
function isAllowed(policy: ModelSelectionPolicy | undefined, route: ModelRoute): boolean {
  if (policy === undefined || policy.routes === undefined) return true
  return policy.routes.some((allowed) => allowed.provider === route.provider && allowed.model === route.model)
}

function formatRoute(route: ModelRoute): string {
  return `${route.provider}/${route.model}`
}

/** The capability table's key for a route; the one place the encoding is defined (see {@link SupportedEfforts}). */
export function routeKeyOf(route: ModelRoute): string {
  return routeKey(route)
}

/**
 * The effort one candidate would run with, by D7's own precedence — chain item
 * override (keyed by model entry) over the agent default, never invented.
 *
 * It has to be answered per candidate, not once for the winner: effort is what
 * decides whether a candidate is *supported*, which in turn decides who the
 * winner is. Expect a circular reading here — it is not one: the item effort
 * depends only on the entry name, the agent default only on the document.
 */
function effortFor(candidate: ChainCandidate, agent: ChainResolutionInput, itemEffort: ChainItemEffort | undefined): string | undefined {
  if (candidate.origin !== 'alias' || candidate.modelName === undefined) return agent.reasoningEffort
  return itemEffort?.[candidate.modelName] ?? agent.reasoningEffort
}

/**
 * R2 §2.7-2: whether this candidate is refused for its effort.
 *
 * Decides nothing unless a table and an effort are both present AND the route
 * has an entry in the table; an absent route is "capability unknown", never a
 * refusal (a missing row must not silently shrink the chain).
 */
function refusesEffort(
  candidate: ChainCandidate,
  agent: ChainResolutionInput,
  itemEffort: ChainItemEffort | undefined,
  supportedEfforts: SupportedEfforts | undefined,
): boolean {
  if (supportedEfforts === undefined || candidate.route === undefined) return false
  const effort = effortFor(candidate, agent, itemEffort)
  if (effort === undefined) return false
  const supported = supportedEfforts[routeKeyOf(candidate.route)]
  return supported !== undefined && !supported.includes(effort)
}

/**
 * The `health` key of a candidate's record — present only when a ledger was
 * injected. Leaving it out otherwise is what keeps a ledger-free report byte
 * for byte the report it was before R2 (spec: 无观测时行为逐字段相等).
 */
function healthProp(health: RouteHealth | undefined): { readonly health?: RouteHealth | undefined } {
  return health === undefined ? {} : { health }
}

/**
 * Expand the alias half into candidate records: one record per alias target, in
 * declaration order.
 *
 * A missing alias is recorded on the alias itself and never produces a record
 * (there is nothing to try); a missing target produces one so the report shows
 * which pointer was broken.
 */
function expandAliases(
  agent: ChainResolutionInput,
  snapshot: AliasRegistrySnapshot,
  policy: ModelSelectionPolicy | undefined,
  health: ReadonlyMap<string, RouteHealth>,
  effortRefused: (candidate: ChainCandidate) => boolean,
): { readonly steps: AliasChainStep[]; readonly candidates: ChainCandidate[] } {
  const models = new Map<string, ModelDefinition>(snapshot.models.map((entry) => [entry.modelName, entry]))
  const aliases = new Map(snapshot.aliases.map((entry) => [entry.alias, entry]))
  const steps: AliasChainStep[] = []
  const candidates: ChainCandidate[] = []

  for (const [orderIndex, alias] of (agent.modelOrder ?? []).entries()) {
    const pointer = aliases.get(alias)
    if (pointer === undefined) {
      steps.push({ orderIndex, alias, targets: [], skipped: 'unknown-alias' })
      continue
    }
    steps.push({ orderIndex, alias, targets: pointer.targets })
    for (const target of pointer.targets) {
      const entry = models.get(target)
      if (entry === undefined) {
        candidates.push({ origin: 'alias', orderIndex, modelName: target, skipped: 'unknown-model' })
        continue
      }
      const route = { provider: entry.provider, model: entry.model }
      const candidate: ChainCandidate = {
        origin: 'alias',
        orderIndex,
        modelName: target,
        route,
        ...healthProp(health.get(routeKey(route))),
      }
      // D6's manual switch comes first: an unavailable entry is not a route this
      // session may pick, so neither the allowlist nor the effort table is asked
      // (spec §5.3-2). Then the allowlist (which the ledger never touches, R2
      // §2.7-1), then effort supportability — one pipeline, and a refusal that
      // DSH's preflight would otherwise raise as a hard error before the child
      // exists (R2 §2.7-2).
      const skipped: ChainSkipReason | undefined = !entry.available
        ? 'unavailable'
        : isAllowed(policy, route) ? (effortRefused(candidate) ? 'unsupported-effort' : undefined) : 'not-allowed'
      candidates.push({ ...candidate, ...skipped === undefined ? {} : { skipped } })
    }
  }
  return { steps, candidates }
}

/**
 * Expand the raw half: the legacy `model:` array straight through, in
 * declaration order (D5 escape hatch; `origin` is the only trace it leaves).
 */
function expandRaw(
  agent: ChainResolutionInput,
  policy: ModelSelectionPolicy | undefined,
  health: ReadonlyMap<string, RouteHealth>,
  effortRefused: (candidate: ChainCandidate) => boolean,
): ChainCandidate[] {
  return (agent.model ?? []).map((target) => {
    const route = { provider: target.provider, model: target.model }
    const candidate: ChainCandidate = { origin: 'raw', route, ...healthProp(health.get(routeKey(route))) }
    // The escape hatch walks the same pipeline as the alias half (residual K).
    const skipped: ChainSkipReason | undefined = !isAllowed(policy, route)
      ? 'not-allowed'
      : effortRefused(candidate) ? 'unsupported-effort' : undefined
    return { ...candidate, ...skipped === undefined ? {} : { skipped } }
  })
}

/** The report row of one candidate; the winner's row simply has no `skipped`. */
function reportOf(candidate: ChainCandidate): ChainCandidateReport {
  return {
    ...candidate.route === undefined ? {} : { route: candidate.route },
    origin: candidate.origin,
    ...candidate.modelName === undefined ? {} : { modelName: candidate.modelName },
    ...candidate.orderIndex === undefined ? {} : { orderIndex: candidate.orderIndex },
    ...candidate.skipped === undefined ? {} : { skipped: candidate.skipped },
    ...healthProp(candidate.health),
  }
}

/**
 * How a candidate reads in the hard error: the name an author recognises — the
 * registry entry, or the alias target when nothing resolved — with the concrete
 * pair it stands for whenever the two differ, so a reader can tell "this entry
 * is disabled" from "this model id is not allowed".
 */
function describe(candidate: ChainCandidate): string {
  const route = candidate.route === undefined ? '' : formatRoute(candidate.route)
  const name = candidate.modelName ?? ''
  const shown = name !== '' && name !== route && route !== ''
    ? `${name} (${route})`
    : name !== '' ? name : route !== '' ? route : '?(unknown)'
  return candidate.origin === 'raw' ? `raw ${shown}` : shown
}

/** The raw half of a converged list; the tail, by construction. */
function rawOf(candidates: readonly ChainCandidate[]): readonly ChainCandidate[] {
  return candidates.filter((candidate) => candidate.origin === 'raw')
}

/**
 * The whole chain as one line, for the hard error (D8: 回显整条链).
 *
 * Every item is named in document order — alias half first, then the raw
 * fallback — with the nodes that never became candidates (`unknown-alias` /
 * an alias with no targets) spelled out too, so a reader can tell a typo from a
 * disabled model.
 */
function describeChain(
  agent: ChainResolutionInput,
  steps: readonly AliasChainStep[],
  candidates: readonly ChainCandidate[],
): string {
  const items: string[] = []
  const reason = (candidate: ChainCandidate): string => candidate.skipped === undefined ? 'available' : candidate.skipped

  for (const step of steps) {
    const label = `modelOrder[${step.orderIndex}] ${step.alias}`
    if (step.skipped === 'unknown-alias') {
      items.push(`${label}: unknown-alias`)
      continue
    }
    const expanded = candidates.filter((candidate) => candidate.origin === 'alias' && candidate.orderIndex === step.orderIndex)
    items.push(expanded.length === 0
      ? `${label}: no targets`
      : `${label} → ${expanded.map((candidate) => `${describe(candidate)}: ${reason(candidate)}`).join(', ')}`)
  }
  for (const [index, candidate] of rawOf(candidates).entries()) {
    items.push(`model[${index}]: ${describe(candidate)}: ${reason(candidate)}`)
  }
  const chain = items.length === 0 ? 'neither modelOrder aliases nor model entries are declared' : items.join('; ')
  return `agent "${agent.agentName}" has no resolvable model; the chain was exhausted: ${chain}`
}

/**
 * The ledger's reading of every route the snapshot knows, keyed by route.
 *
 * Derived from the very projection `./observations.ts` exposes
 * (`withAvailability`), so "project the snapshot, then resolve" and "resolve
 * with `observations`" share one rule — the three thresholds live there, not
 * here. What stays local is only the *lookup*: the pipeline carries candidates,
 * not model entries, so each candidate asks this map for its route's health.
 *
 * Empty when no ledger was injected: nothing to say, so no `health` is
 * written and the report keeps the exact shape it had before R2.
 */
function projectHealth(context: ChainResolutionContext): ReadonlyMap<string, RouteHealth> {
  if (context.observations === undefined) return new Map()
  return new Map(withAvailability(context.snapshot, context.observations, context.now).map((entry) => [routeKey(entry), entry.health]))
}

/**
 * Pool order (R2 §2.6): within one pool, every `active` candidate keeps its
 * declaration order and every `degraded` one follows, also in declaration
 * order. `disabled` items never reach this: they were skipped as unavailable
 * and stay where the chain put them. Without a ledger every candidate is
 * `undefined`-health ⇒ `active`, and the sort is the identity.
 */
function poolOrdered(records: readonly ChainCandidate[]): readonly ChainCandidate[] {
  const rank = (candidate: ChainCandidate): number => candidate.health === 'degraded' ? 1 : 0
  return records.every((candidate) => rank(candidate) === 0)
    ? records
    : records.map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => rank(left.candidate) - rank(right.candidate) || left.index - right.index)
      .map(({ candidate }) => candidate)
}

/**
 * THE engine entry: resolve one agent's model chain.
 *
 * Order (spec §5.3): the alias chain in declaration order, then the raw
 * fallback, each candidate gated by availability and the allowlist, the first
 * survivor wins; running out is a hard error echoing the whole chain. The
 * result also carries what session start needs — persona, tool filter, flavor —
 * plus the report the UI (05) and catalog warnings (06) render.
 *
 * With a ledger injected (R2 §3.2) the order is "declaration order, with each
 * pool's `degraded` candidates moved behind its `active` ones": the first
 * survivor is then still the first *declared* survivor, unless the ledger says
 * one of them has been failing — which only changes who is tried first, never
 * whether a route may be tried (the allowlist and `available` alone decide
 * that). The raw fallback keeps its declaration order: it is the escape hatch,
 * not a pool.
 *
 * Deterministic and total: same input, same output, never throws.
 */
export function resolveModelChain(context: ChainResolutionContext): ChainResolution {
  const { agent, snapshot, policy } = context
  const health = projectHealth(context)
  const effortRefused = (candidate: ChainCandidate): boolean =>
    refusesEffort(candidate, agent, context.itemEffort, context.supportedEfforts)
  const alias = expandAliases(agent, snapshot, policy, health, effortRefused)
  const raw = expandRaw(agent, policy, health, effortRefused)
  // The convergence point (residual K): one list, one order, one pipeline.
  // Alias expansion already decided every skip; this walk only keeps the order,
  // and demotes each pool's degraded candidates within that pool (R2 §2.6).
  const candidates = [...poolOrdered(alias.candidates), ...raw]
  const winnerIndex = candidates.findIndex((candidate) => candidate.skipped === undefined)
  const winner = winnerIndex === -1 ? undefined : candidates[winnerIndex]
  // DSH stops at the first allowed route, so a link after the winner was never
  // tried — say so instead of implying it lost on a rule.
  const reports = candidates.map((candidate, index) =>
    reportOf(winnerIndex !== -1 && index > winnerIndex ? { ...candidate, skipped: 'not-reached' } : candidate))

  // R1-C: the step names the candidate that *won* from this alias. It is the
  // winner alone — in a pool of one (v1) that is also the first entry, but once
  // a pool has two targets "the first candidate of this step" can be a skipped
  // one while the alias actually resolved through its sibling.
  const aliasChain = alias.steps.map((step): AliasChainStep => {
    if (step.skipped !== undefined || winner === undefined) return step
    const hit = winner.origin === 'alias' && winner.orderIndex === step.orderIndex ? winner.modelName : undefined
    return hit === undefined ? step : { ...step, modelName: hit }
  })
  const report = (effortSource: EffortSource): ChainResolutionReport => ({
    aliasChain,
    rawFallbackUsed: raw.length > 0,
    candidates: reports,
    // A failed chain selected nothing; `ok: false` is the only reading of the report.
    selectedBy: winner?.origin ?? 'none',
    effortSource,
  })

  if (winner === undefined || winner.route === undefined) {
    const failure: ChainResolutionFailure = {
      ok: false,
      code: 'chain-exhausted',
      message: describeChain(agent, alias.steps, candidates),
      report: report('none'),
    }
    return failure
  }

  // D7: the chain item's own effort covers the agent default; neither invents one.
  const itemEffort = winner.origin === 'alias' && winner.modelName !== undefined
    ? context.itemEffort?.[winner.modelName]
    : undefined
  const effort = itemEffort ?? agent.reasoningEffort
  const effortSource: EffortSource = itemEffort !== undefined ? 'chain' : agent.reasoningEffort !== undefined ? 'agent' : 'none'

  return {
    ok: true,
    provider: winner.route.provider,
    model: winner.route.model,
    ...effort === undefined ? {} : { reasoningEffort: effort },
    persona: agent.body,
    toolFilter: agent.requiredTools ?? [],
    flavor: context.flavor ?? agent.spawn ?? 'spawn',
    report: report(effortSource),
  }
}
