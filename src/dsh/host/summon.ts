/**
 * The summon plugin row (ticket 07): the model-facing summon_agent tool, the
 * child-creation composition hook, and the runtime replacement of DSH's native
 * delegation entries.
 *
 * DSH 0.2.2-rc.1 no longer carries persona/toolFilter on a subagent start
 * request, and system-prompt/assemble no longer carries tools (both moved to
 * Agent Presets and the tool registry). This row therefore composes on the one
 * seam the host still offers a bundle: agent/created runs before the child's
 * first prompt assembly, so the child's own scoped context can receive the
 * Agent's assembly sections and tool restriction. The child id is reserved by
 * this tool before the start call, which makes the correlation exact even when
 * several summons run concurrently.
 *
 * The native entries are hidden with tools.restrict() on every live Agent
 * scope; tools.schemas(agent) reads the restricted view, so the model never
 * sees both entry points. keepNativeSubagentTools: true is the documented
 * compatibility fallback.
 *
 * The host packages are never imported at runtime (ADR-0001): service and
 * event shapes are local structural mirrors; the clock-free decisions live in
 * src/control/summon.ts and are unit-tested there.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'

import {
  createFailureRecorder,
  missingRequiredTools,
  planSummonStart,
  readSummonArguments,
  summonRestriction,
} from '../../control/index.ts'
import { mountFailureLedger } from './failures.ts'

import type { ComposedAgentSession, FailureRecorder } from '../../control/index.ts'
import type { AgentAssembly, AssemblyScope, AssemblySession, ChainObservations } from '../../contract/index.ts'

/** Model-facing name of this bundle's delegation entry. */
export const SUMMON_TOOL_NAME = 'summon_agent'

/** The native delegation entries the bundle replaces unless configured otherwise. */
export const DEFAULT_NATIVE_SUBAGENT_TOOLS = ['subagent', 'subagent_fork'] as const

/** Loader-row config of the summon row; every field is optional. */
export interface SummonPluginConfig {
  /**
   * Keep the native subagent/subagent_fork entries visible. The runtime
   * switch for a compatibility fallback; when true the bundle only adds the
   * summon entry and leaves native delegation untouched.
   */
  readonly keepNativeSubagentTools?: boolean | undefined
  /** Native tool names to hide; defaults to DEFAULT_NATIVE_SUBAGENT_TOOLS. */
  readonly nativeToolNames?: readonly string[] | undefined
  /**
   * Delegation-depth cap for the child. A number is enforced by the provider
   * when it supports depthLimit; 'provider-managed' leaves the budget to
   * the provider/child runtime. Omitted reads the host's current setting.
   */
  readonly maxDepth?: number | 'provider-managed' | undefined
}

/** One live Agent on the host registry (the members this row reads). */
interface HostAgent {
  readonly id: string
  readonly ctx: HostAgentContext
  readonly session: {
    readonly header: {
      readonly cwd?: string | undefined
      /** Coarse product origin; `subagent` marks a delegated child. */
      readonly origin?: string | undefined
      readonly delegationDepth?: number | undefined
    }
  }
}

/** Agent-scoped context slice: the two services composition touches. */
interface HostAgentContext {
  readonly tools?: {
    restrict(filter: { readonly deny: readonly string[] }): () => void
  } | undefined
  readonly systemPrompt?: unknown
}

/** The host tools service slice this row uses. */
interface HostTools {
  register(definition: HostToolDefinition): () => void
  schemas(scope?: HostAgent): readonly { readonly name: string }[]
}

/** The host agents registry slice. */
interface HostAgents {
  list(): readonly HostAgent[]
}

/** The host subagent service slice. */
interface HostSubagents {
  getProvider(name: string): HostSubagentProvider | undefined
  resolveMaxDepth(configured?: number | 'provider-managed'): number | undefined
  startActivation(spec: HostActivationSpec): Promise<HostActivation>
}

interface HostSubagentProvider {
  readonly name: string
  readonly capabilities: {
    readonly agentOptions: boolean
    readonly depthLimit: boolean
  }
  /**
   * Local/continuable creation capability; method presence is the host's own
   * test. Only this backend accepts a reserved child id, which is what makes
   * the child Agent correlatable at agent/created.
   */
  readonly prepareContinuable?: unknown
}

interface HostActivationSpec {
  readonly provider: string
  readonly label: string
  /** Reserved identity, local backends only. */
  readonly childId?: string | undefined
  readonly request: {
    readonly prompt: readonly { readonly type: 'text'; readonly text: string }[]
    readonly parent: HostAgent
    readonly agentOptions?: {
      readonly provider: string
      readonly model: string
      readonly reasoningEffort?: string | undefined
    } | undefined
    readonly maxDepth?: number | undefined
    readonly cwd?: string | undefined
  }
  readonly signal: AbortSignal
  readonly delivery: 'parent'
}

interface HostActivation {
  readonly childId: string
  readonly messageId?: string | undefined
  readonly result: Promise<unknown>
  dispose(): Promise<void>
}

/** The delegation service slice of the control core. */
interface HostAgentControl {
  composeSession(
    agentName: string,
    options?: {
      readonly cwd?: string | undefined
      readonly flavor?: 'spawn' | 'fork' | undefined
      /** The runtime failure ledger the executor recorded so far (07b). */
      readonly observations?: ChainObservations | undefined
      /** Epoch milliseconds the ledger was read at. */
      readonly now?: number | undefined
    },
  ): Promise<ComposedAgentSession>
}

/** The working-directory service slice. */
interface HostWorkingDirectory {
  ensure(agent: HostAgent, signal: AbortSignal): Promise<string>
}

/** One tool definition as the host registry takes it (the members this row fills). */
interface HostToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): readonly { readonly type: 'text'; readonly text: string }[]
  }
  execute(args: unknown, exec: { readonly agent?: HostAgent | undefined; readonly signal: AbortSignal }): Promise<unknown>
  isConcurrencySafe?(args: unknown): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The host's serial creation event; listeners run after factory setup and
     * before AgentLoop releases queued input, which is exactly the composition
     * window ticket 07 needs. Declared locally because the host package is
     * type-only externally vendored and never imported (ADR-0001).
     */
    'agent/created'(this: unknown, payload: { readonly agent: HostAgent }): undefined | Promise<undefined>
  }
}

/** A reserved child id waiting for its child Agent to appear. */
interface PendingSummon {
  readonly session: ComposedAgentSession
}

/**
 * Mount the summon row.
 *
 * The tool, the composition listener and the replacement restrictions are one
 * concern: they share the pending summon ledger and the same compatibility
 * switch. Registration waits for the three host services the row consumes;
 * everything else is read at use time so a service mounted later is honoured.
 */
export function applySummon(ctx: Context, config: SummonPluginConfig = {}): void {
  const keepNative = config.keepNativeSubagentTools === true
  const nativeToolNames = normalizeNativeToolNames(config.nativeToolNames)
  const pending = new Map<string, PendingSummon>()
  // 07b: one in-memory, row-lived ledger. Both runtime legs write into it and
  // the tool below hands its current reading to chain resolution, so a route
  // that keeps failing is demoted on the next summon (R2 §2.2/§2.4).
  const clock = (): number => Date.now()
  const failures = createFailureRecorder()
  ctx.effect(() => mountFailureLedger(ctx, failures, { now: clock }))
  ctx.inject(['tools', 'subagents', 'agents'], (scope) => {
    const tools = scope.get('tools') as unknown as HostTools | undefined
    const agents = scope.get('agents') as unknown as HostAgents | undefined
    const subagents = scope.get('subagents') as unknown as HostSubagents | undefined
    if (tools === undefined || agents === undefined || subagents === undefined) {
      scope.logger.warn('summon_agent: host tools/subagents/agents services are unavailable; the row stays inert')
      return
    }
    // Registering the tool first means the replacement only ever hides the
    // native entries once the bundle's own entry exists.
    scope.effect(() => tools.register(createSummonTool(scope, subagents, pending, config, failures, clock)))
    // Mount on every Agent this row sees: existing Agents (a hot-reloaded row)
    // and every later creation, including the summons this tool starts.
    for (const agent of agents.list()) void installRestrictions(scope, tools, agent, nativeToolNames, keepNative, pending)
    scope.effect(() => scope.on('agent/created', async (payload) => {
      await installRestrictions(scope, tools, payload.agent, nativeToolNames, keepNative, pending)
    }))
  })
}

/** Build the model-facing tool definition over the live host services. */
function createSummonTool(
  scope: Context,
  subagents: HostSubagents,
  pending: Map<string, PendingSummon>,
  config: SummonPluginConfig,
  failures: FailureRecorder,
  clock: () => number,
): HostToolDefinition {
  return {
    name: SUMMON_TOOL_NAME,
    description:
      'Summon one expert from the Agent Atelier roster by its stable agent name. '
      + 'The expert runs as a separate agent with its own persona, model chain and tool composition; '
      + 'this call starts it and immediately returns the child subagent id. '
      + 'The result is delivered back automatically when the expert finishes. '
      + 'Pick a name from the available_agents catalog; a fresh expert does not share this '
      + 'conversation, so restate the task fully.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: {
          type: 'string',
          description: 'Stable agent name from the available_agents catalog, for example code-reviewer.',
        },
        description: {
          type: 'string',
          description: 'A short (3-5 word) label for this delegation, shown in the agent list. '
            + 'Use the language of the current request.',
        },
        prompt: {
          type: 'string',
          description: 'The complete task for the expert. A fresh child does not share this conversation, '
            + 'so include everything it needs; a forked child already sees the completed turns.',
        },
        flavor: {
          type: 'string',
          enum: ['spawn', 'fork'],
          description: 'spawn starts a fresh expert with no shared conversation context; fork seeds it with '
            + 'the completed turns of this conversation. Omit to use the expert default.',
        },
        cwd: {
          type: 'string',
          description: 'Initial working directory for the expert. Relative paths resolve against the caller '
            + 'current directory; omitted inherits it.',
        },

      },
      required: ['agent', 'description', 'prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['activation'] },
          subagentId: { type: 'string' },
        },
        required: ['kind', 'subagentId'],
      },
      render(args, value) {
        const id = (value as { readonly subagentId?: unknown }).subagentId
        const agent = (args as { readonly agent?: unknown }).agent
        const shown = typeof id === 'string' ? id : 'subagent'
        return [{ type: 'text', text: typeof agent === 'string' ? 'started subagent ' + shown + ' (' + agent + ')' : 'started subagent ' + shown }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(raw, exec) {
      const args = readSummonArguments(raw)
      const parent = exec.agent
      if (parent === undefined) throw new Error('summon_agent requires a calling agent')
      const control = scope.get('agentControl') as unknown as HostAgentControl | undefined
      if (control === undefined) throw new Error('summon_agent: the agent control service is unavailable')

      const parentCwd = await resolveParentCwd(scope, parent, exec.signal)
      let childCwd: string | undefined
      if (args.cwd !== undefined) {
        childCwd = isAbsolute(args.cwd) || parentCwd === undefined ? args.cwd : resolve(parentCwd, args.cwd)
      }
      // Read the ledger once and use the same instant for the read and the
      // resolution, so a rate-limit window cannot be judged against two clocks.
      const observedAt = clock()
      const ledger = failures.observations(observedAt)
      const composed = await control.composeSession(args.agent, {
        ...parentCwd === undefined ? {} : { cwd: parentCwd },
        ...args.flavor === undefined ? {} : { flavor: args.flavor },
        // An empty ledger is "no observations": pass nothing so the report
        // keeps the exact shape it had before R2 (see projectHealth).
        ...ledger.routes.length === 0 ? {} : { observations: ledger, now: observedAt },
      })
      exec.signal.throwIfAborted()

      const provider = subagents.getProvider(composed.parameters.flavor)
      if (provider === undefined) {
        throw new Error('summon_agent: subagent provider "' + composed.parameters.flavor + '" is not registered')
      }
      const maxDepth = config.maxDepth === 'provider-managed'
        ? undefined
        : typeof config.maxDepth === 'number' ? config.maxDepth : subagents.resolveMaxDepth(undefined)
      const plan = planSummonStart(composed, provider.capabilities, maxDepth)
      for (const warning of plan.warnings) scope.logger.warn('summon_agent: ' + warning)

      // Only a local provider accepts a reserved child id: external backends
      // allocate the id themselves and never create a local Agent, so there is
      // nothing for agent/created to correlate. Local is the host's own test:
      // method presence, not a separate capability flag.
      const local = provider.prepareContinuable !== undefined
      const childId = local ? randomUUID() : undefined
      if (childId === undefined) {
        scope.logger.warn('summon_agent: provider "' + plan.provider + '" has no local child; the persona and child tool mask are not applied')
      } else {
        pending.set(childId, { session: composed })
      }
      try {
        const activation = await subagents.startActivation({
          provider: plan.provider,
          label: args.description,
          ...childId === undefined ? {} : { childId },
          request: {
            prompt: [{ type: 'text', text: args.prompt }],
            parent,
            ...plan.agentOptions === undefined ? {} : { agentOptions: plan.agentOptions },
            ...plan.maxDepth === undefined ? {} : { maxDepth: plan.maxDepth },
            ...childCwd === undefined ? {} : { cwd: childCwd },
          },
          signal: exec.signal,
          delivery: 'parent',
        })
        // The child may never be created (concurrent duplicate id, failed
        // start); the settled activation is the fallback cleanup.
        if (childId !== undefined) {
          void activation.result.then(
            () => { pending.delete(childId) },
            () => { pending.delete(childId) },
          )
        }
        return { kind: 'activation', subagentId: activation.childId }
      } catch (error) {
        if (childId !== undefined) pending.delete(childId)
        throw error
      }
    },
  }
}

/**
 * Whole-agent composition at the host's creation seam.
 *
 * The pending entry only exists for children this bundle summoned. Anything
 * else (a native delegation, another plugin's Agent) gets the tool mask alone,
 * so this row never rewrites an unrelated Agent's prompt.
 */
async function installRestrictions(
  scope: Context,
  tools: HostTools,
  agent: HostAgent,
  nativeToolNames: readonly string[],
  keepNative: boolean,
  pending: Map<string, PendingSummon>,
): Promise<void> {
  const reserved = pending.get(agent.id)
  pending.delete(agent.id)
  if (reserved !== undefined) {
    const assembly = scope.get('agentAssembly') as unknown as AgentAssembly | undefined
    if (assembly === undefined) {
      scope.logger.warn('summon_agent: the assembly service is unavailable; the summoned agent runs without its assembly sections')
    } else {
      try {
        await assembly.registerAssemblySections({
          scope: agent.ctx as unknown as AssemblyScope,
          session: reserved.session as unknown as AssemblySession,
        })
      } catch (error) {
        throw new Error('summon_agent: cannot mount the assembly for "' + reserved.session.agent.agentName + '": ' + messageOf(error))
      }
    }
  }

  try {
    const origin = agent.session.header.origin
    const globalNames = new Set(tools.schemas().map(schema => schema.name))
    const mask = summonRestriction({
      origin,
      keepNativeSubagentTools: keepNative,
      globalToolNames: globalNames,
      nativeToolNames,
      summonToolName: SUMMON_TOOL_NAME,
    })
    if (mask !== undefined) {
      const scoped = agent.ctx.tools
      if (scoped === undefined || typeof scoped.restrict !== 'function') {
        scope.logger.warn('summon_agent: agent "' + agent.id + '" has no scoped tools service; its tool mask is not applied')
      } else {
        // Tie the mask to this row's lifetime: a disposer the row keeps means
        // an unload/reload lifts the restriction instead of leaving a stale
        // mask on a still-live Agent (which would defeat keepNativeSubagentTools
        // after HMR).
        scope.effect(() => scoped.restrict(mask))
      }
    }
    if (reserved !== undefined) {
      const visible = new Set(tools.schemas(agent).map(schema => schema.name))
      const missing = missingRequiredTools(reserved.session, visible)
      if (missing.length > 0) {
        scope.logger.warn('summon_agent: "' + reserved.session.agent.agentName + '" declares required tools that are not visible: ' + missing.join(', '))
      }
    }
  } catch (error) {
    // Advisory: a tool-surface edit must not fail Agent creation. The native
    // entries stay visible if it does, so the model can still work.
    scope.logger.warn('summon_agent: cannot apply the tool surface to agent "' + agent.id + '": ' + messageOf(error))
  }
}

/** Resolve the caller's current directory, falling back to its session header. */
async function resolveParentCwd(ctx: Context, parent: HostAgent, signal: AbortSignal): Promise<string | undefined> {
  const workingDirectory = ctx.get('workingDirectory') as unknown as HostWorkingDirectory | undefined
  if (workingDirectory !== undefined && typeof workingDirectory.ensure === 'function') {
    try {
      const cwd = await workingDirectory.ensure(parent, signal)
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch (error) {
      if (signal.aborted) throw error
      ctx.logger.warn('summon_agent: cannot resolve the caller working directory: ' + messageOf(error))
    }
  }
  const cwd = parent.session.header.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/** Normalise the configured native tool names; defaults when absent or empty. */
function normalizeNativeToolNames(names: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(names)) return DEFAULT_NATIVE_SUBAGENT_TOOLS
  const kept = names.filter(name => typeof name === 'string' && name.trim() !== '')
  return kept.length === 0 ? DEFAULT_NATIVE_SUBAGENT_TOOLS : kept
}

/** One line for a warning even when the thrown value is not an Error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Plugin entry: the loader mounts this module through its named apply. */
export const apply = applySummon
