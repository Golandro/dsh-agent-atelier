/**
 * Summon start planning (ticket 07): the pure decisions between a resolved
 * Agent session and the host delegation call. No host import, no I/O, no
 * randomness — the caller injects capabilities and the live tool names, so the
 * rules are testable without a Cordis context.
 *
 * DSH 0.2.2-rc.1 removed `persona`/`toolFilter` from `SubagentStartRequest`
 * (persona and tool composition now belong to a selected Agent Preset). This
 * bundle keeps its own composition instead: the host row mounts the Agent's
 * assembly sections on the child's scoped context at `agent/created`, and
 * restricts its tool surface there. This module only decides what the start
 * call carries, never how the child is composed.
 */
import type { ComposedAgentSession } from './session.ts'

/** Host-native tool mask shape (`ToolRestriction`), declared structurally. */
export interface SummonToolMask {
  readonly deny: readonly string[]
}

/** The subagent-provider start capabilities summon actually reads. */
export interface SummonProviderCapabilities {
  readonly agentOptions: boolean
  readonly depthLimit: boolean
}

/** Host agent-options slice: a resolved route plus the engine's effort, never invented. */
export interface SummonAgentOptions {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** One start decision: provider, child options, depth cap, advisory warnings. */
export interface SummonStartPlan {
  readonly provider: 'spawn' | 'fork'
  readonly agentOptions?: SummonAgentOptions | undefined
  readonly maxDepth?: number | undefined
  readonly warnings: readonly string[]
}

/**
 * Whether a resolved session is the bundled `default` bridge.
 *
 * The bridge must behave like the native delegation call: no persona, no
 * registry route forced onto the child. The native tool omits `agentOptions`
 * when the model does not name one, so the provider inherits the parent route;
 * forcing the `dsh-default` pair would instead change the route whenever the
 * parent's live selection differs from the host default pair (D4).
 *
 * Structural test, not an origin check: a user may override `default` without
 * changing its shape, and such a document is still the empty-persona,
 * default-chain bridge.
 */
export function isDefaultBridge(session: ComposedAgentSession): boolean {
  const agent = session.agent
  if (agent.agentName !== 'default') return false
  if (agent.body.trim() !== '') return false
  if ((agent.model?.length ?? 0) > 0) return false
  const order = agent.modelOrder ?? []
  return order.length === 1 && order[0] === 'dsh-default'
}

/**
 * Plan one `summon_agent` start from the session `composeSession` produced.
 *
 * - The provider is the engine's effective flavor (call-site override, then
 *   the document's `spawn`, then `spawn`; D13), never the raw argument.
 * - The default bridge omits `agentOptions` on purpose (see
 *   {@link isDefaultBridge}); every other Agent carries its resolved route.
 * - A provider without `agentOptions` degrades to "let the provider inherit
 *   the parent route" and reports why; the chain itself is already resolved,
 *   so a failed chain never reaches this function (it throws earlier).
 * - A provider without `depthLimit` drops the cap and reports why; the host
 *   provider's own budget still applies.
 */
export function planSummonStart(
  session: ComposedAgentSession,
  capabilities: SummonProviderCapabilities,
  maxDepth: number | undefined,
): SummonStartPlan {
  const provider = session.parameters.flavor
  const warnings: string[] = []
  let agentOptions: SummonAgentOptions | undefined
  if (!isDefaultBridge(session)) {
    if (capabilities.agentOptions) {
      const { route, reasoningEffort } = session.parameters
      agentOptions = {
        provider: route.provider,
        model: route.model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    } else {
      warnings.push(
        `provider "${provider}" does not support child agent options; the resolved route `
        + `${session.parameters.route.provider}/${session.parameters.route.model} is not applied`,
      )
    }
  }
  let depth = maxDepth
  if (depth !== undefined && !capabilities.depthLimit) {
    warnings.push(`provider "${provider}" cannot enforce maxDepth; the delegation-depth cap is left to the provider`)
    depth = undefined
  }
  return {
    provider,
    ...agentOptions === undefined ? {} : { agentOptions },
    ...depth === undefined ? {} : { maxDepth: depth },
    warnings,
  }
}

/** Inputs of one live agent's tool mask. */
export interface SummonRestrictionInput {
  /** Durable session origin: `subagent` for every delegated child, absent for a root. */
  readonly origin: string | undefined
  /** Ticket 07's compatibility switch: keep the native delegation entries visible. */
  readonly keepNativeSubagentTools: boolean
  /** Every globally registered tool name, before per-agent restrictions. */
  readonly globalToolNames: ReadonlySet<string>
  /** Model-facing native delegation tool names to replace. */
  readonly nativeToolNames: readonly string[]
  /** This bundle's own delegation tool. */
  readonly summonToolName: string
}

/**
 * The tool mask one live agent needs, or `undefined` when nothing is hidden.
 *
 * A root Agent loses the native `subagent`/`subagent_fork` entries unless the
 * compatibility switch keeps them. Every delegated child additionally loses
 * `summon_agent` itself: the summon path must not recurse through the same
 * tool at depth, and the host's `maxDepth` remains the second guard (Agency's
 * precedent). Names are filtered against the global registry because
 * `tools.restrict()` rejects scope-local names and an absent native tool
 * (a minimal deployment) must not turn into a throw.
 */
export function summonRestriction(input: SummonRestrictionInput): SummonToolMask | undefined {
  const deny: string[] = []
  if (!input.keepNativeSubagentTools) {
    for (const name of input.nativeToolNames) {
      if (input.globalToolNames.has(name)) deny.push(name)
    }
  }
  if (input.origin === 'subagent' && input.globalToolNames.has(input.summonToolName)) deny.push(input.summonToolName)
  return deny.length === 0 ? undefined : { deny }
}

/**
 * Declared `requiredTools` the child's live surface does not expose.
 *
 * Advisory only (D9): the tool call still starts, the child still runs, and the
 * caller gets one log line. Sorted so repeated calls produce identical text.
 */
export function missingRequiredTools(
  session: ComposedAgentSession,
  visibleToolNames: ReadonlySet<string>,
): readonly string[] {
  return (session.agent.requiredTools ?? []).filter(name => !visibleToolNames.has(name)).sort()
}

/** One validated `summon_agent` argument object. */
export interface SummonArguments {
  readonly agent: string
  readonly description: string
  readonly prompt: string
  readonly flavor?: 'spawn' | 'fork' | undefined
  readonly cwd?: string | undefined
}

/**
 * Read and validate the model-supplied arguments.
 *
 * The host executor validates only the canonical output, not the raw
 * arguments (the native helper does both); this is the one gate before a
 * registry read and a child Agent. Unknown keys are rejected rather than
 * ignored so a typo cannot silently change a delegation.
 */
export function readSummonArguments(raw: unknown): SummonArguments {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('summon_agent: arguments must be an object')
  }
  const record = raw as Record<string, unknown>
  const allowed = new Set(['agent', 'description', 'prompt', 'flavor', 'cwd'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`summon_agent: unknown argument "${key}"`)
  }
  const agent = requiredString(record, 'agent')
  const description = requiredString(record, 'description')
  const prompt = requiredString(record, 'prompt')
  const flavor = optionalString(record, 'flavor')
  if (flavor !== undefined && flavor !== 'spawn' && flavor !== 'fork') {
    throw new Error('summon_agent: flavor must be "spawn" or "fork"')
  }
  const cwd = optionalString(record, 'cwd')
  return {
    agent,
    description,
    prompt,
    ...flavor === undefined ? {} : { flavor },
    ...cwd === undefined ? {} : { cwd },
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`summon_agent: "${key}" must be a non-empty string`)
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`summon_agent: "${key}" must be a non-empty string`)
  return value
}
