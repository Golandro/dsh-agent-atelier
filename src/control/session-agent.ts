/**
 * The session-start half of the control core (ticket 19 / #32): what turns a
 * resolved chain into the answer ticket 07's adapter starts a child Agent with,
 * plus the error a chain that ran out raises.
 *
 * Split from `./core.ts` because it is a different concern with a different
 * failure style: the write face answers in data, this one owns the engine's one
 * hard error. Both halves read the same injected registries and share
 * `./resolve.ts`'s projections; neither re-implements resolution.
 */
import { routeNotAllowed } from './resolve.ts'

import type {
  AgentDefinition,
  AliasRegistrySnapshot,
  ChainResolution,
  ChainResolutionInput,
  ModelDefinition,
} from '../contract/index.ts'
import type { ComposedAgentSession, SessionStartParameters } from './session.ts'

/**
 * A resolved chain that ran out, thrown by `ControlCore.composeSession`.
 *
 * The engine answers failures as data (`{ ok: false, code, message, report }`);
 * the session-start path re-throws that answer *as is* — same message, same
 * report, no rewriting (D8) — with one extra, purely diagnostic flag: whether
 * any route in the chain was refused by the host's allowlist rather than the
 * registry's `available` switch.
 */
export class ChainExhaustedError extends Error {
  /** The engine's stable machine code, unchanged. */
  readonly code = 'chain-exhausted' as const
  /** The engine's report, echoed whole. */
  readonly report: ChainResolution['report']
  /** True when the host allowlist refused at least one concrete route. */
  readonly notAllowed: boolean

  constructor(failure: Extract<ChainResolution, { readonly ok: false }>, notAllowed: boolean) {
    super(failure.message)
    this.name = 'ChainExhaustedError'
    this.report = failure.report
    this.notAllowed = notAllowed
  }
}

/**
 * The engine's input, projected from the document: only the fields chain
 * resolution reads, passed through untouched (the body is the persona channel,
 * required tools the filter request, `spawn` the default flavor).
 */
export function chainInputOf(definition: AgentDefinition): ChainResolutionInput {
  return {
    agentName: definition.agentName,
    modelOrder: definition.modelOrder,
    model: definition.model,
    reasoningEffort: definition.reasoningEffort,
    body: definition.body,
    requiredTools: definition.requiredTools,
    spawn: definition.spawn,
  }
}

/** The success answer: the engine's own parameters, nothing re-derived. */
export function composeSessionOf(
  definition: AgentDefinition,
  cwd: string | undefined,
  resolution: Extract<ChainResolution, { readonly ok: true }>,
  snapshot: AliasRegistrySnapshot,
): ComposedAgentSession {
  const parameters: SessionStartParameters = {
    route: { provider: resolution.provider, model: resolution.model },
    ...resolution.reasoningEffort === undefined ? {} : { reasoningEffort: resolution.reasoningEffort },
    persona: resolution.persona,
    toolFilter: resolution.toolFilter,
    flavor: resolution.flavor,
    effortSource: resolution.report.effortSource,
  }
  const model = winningModelOf(snapshot, resolution)
  return {
    ok: true,
    agent: definition,
    ...cwd === undefined ? {} : { cwd },
    parameters,
    report: resolution.report,
    ...model === undefined ? {} : { model },
  }
}

/**
 * The winning registry entry, when an alias target won.
 *
 * The report already names it: the winner is the one candidate without a
 * `skipped` reason, and its `modelName` is the snapshot's own key. A raw
 * `model:` winner contributes no entry — assembly must not invent one.
 */
function winningModelOf(
  snapshot: AliasRegistrySnapshot,
  resolution: Extract<ChainResolution, { readonly ok: true }>,
): ModelDefinition | undefined {
  if (resolution.report.selectedBy !== 'alias') return undefined
  const winner = resolution.report.candidates.find((candidate) => candidate.skipped === undefined)
  const modelName = winner?.modelName
  if (modelName === undefined) return undefined
  return snapshot.models.find((entry) => entry.modelName === modelName)
}

/** Re-exported so `./core.ts` reads one module for the whole session half. */
export { routeNotAllowed }
