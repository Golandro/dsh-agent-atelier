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
 */
import type {
  AliasChainStep,
  AliasRegistrySnapshot,
  ChainCandidateReport,
  ChainResolution,
  ChainResolutionFailure,
  ChainResolutionInput,
  ChainResolutionReport,
  ChainSkipReason,
  EffortSource,
  ModelDefinition,
  ModelRoute,
  ModelSelectionPolicy,
} from '../../contract/index.ts'

/**
 * Per-model-entry effort overrides, keyed by registry model name (D7's "链项
 * 自带"). A `models:` entry has no effort column in spec §5.2, so the override
 * table is injected rather than read from the snapshot; when nothing supplies
 * one, the agent-level default is used, exactly as the spec spells it out.
 */
export type ChainItemEffort = Readonly<Record<string, string | undefined>>

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
}

/** The allowlist decision, DSH-shaped: no policy ⇒ allowed; otherwise an exact route match. */
function isAllowed(policy: ModelSelectionPolicy | undefined, route: ModelRoute): boolean {
  if (policy === undefined || policy.routes === undefined) return true
  return policy.routes.some((allowed) => allowed.provider === route.provider && allowed.model === route.model)
}

function formatRoute(route: ModelRoute): string {
  return `${route.provider}/${route.model}`
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
      // D6's manual switch comes first: an unavailable entry is not a route this
      // session may pick, so the allowlist is not even asked (spec §5.3-2).
      const skipped: ChainSkipReason | undefined = entry.available
        ? isAllowed(policy, route) ? undefined : 'not-allowed'
        : 'unavailable'
      candidates.push({ origin: 'alias', orderIndex, modelName: target, route, ...skipped === undefined ? {} : { skipped } })
    }
  }
  return { steps, candidates }
}

/**
 * Expand the raw half: the legacy `model:` array straight through, in
 * declaration order (D5 escape hatch; `origin` is the only trace it leaves).
 */
function expandRaw(agent: ChainResolutionInput, policy: ModelSelectionPolicy | undefined): ChainCandidate[] {
  return (agent.model ?? []).map((target) => {
    const route = { provider: target.provider, model: target.model }
    return { origin: 'raw' as const, route, ...isAllowed(policy, route) ? {} : { skipped: 'not-allowed' as const } }
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
 * THE engine entry: resolve one agent's model chain.
 *
 * Order (spec §5.3): the alias chain in declaration order, then the raw
 * fallback, each candidate gated by availability and the allowlist, the first
 * survivor wins; running out is a hard error echoing the whole chain. The
 * result also carries what session start needs — persona, tool filter, flavor —
 * plus the report the UI (05) and catalog warnings (06) render.
 *
 * Deterministic and total: same input, same output, never throws.
 */
export function resolveModelChain(context: ChainResolutionContext): ChainResolution {
  const { agent, snapshot, policy } = context
  const alias = expandAliases(agent, snapshot, policy)
  const raw = expandRaw(agent, policy)
  // The convergence point (residual K): one list, one order, one pipeline.
  // Alias expansion already decided every skip; this walk only keeps the order.
  const candidates = [...alias.candidates, ...raw]
  const winnerIndex = candidates.findIndex((candidate) => candidate.skipped === undefined)
  const winner = winnerIndex === -1 ? undefined : candidates[winnerIndex]
  // DSH stops at the first allowed route, so a link after the winner was never
  // tried — say so instead of implying it lost on a rule.
  const reports = candidates.map((candidate, index) =>
    reportOf(winnerIndex !== -1 && index > winnerIndex ? { ...candidate, skipped: 'not-reached' } : candidate))

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
