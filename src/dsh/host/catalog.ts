/**
 * Host adapter of the agent catalog (ticket 06): the pre-step waterfall
 * listener the core row installs.
 *
 * It reads the two registries and the host's effective capability surfaces
 * structurally, projects one pure catalog snapshot, and publishes at most one
 * message per step through the digest gate. A failure of any host probe is
 * advisory: one warning, the unmodified decision, and the turn continues.
 *
 * The host packages are never imported at runtime (ADR-0001): the event and
 * service shapes below are local structural mirrors, and the SHA-256 function
 * and message ids are supplied here so `agent-assembly` stays pure.
 */
import { createHash, randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'

import {
  catalogDigest,
  createCatalogMessage,
  digestCatalogSource,
  planCatalogPublish,
  projectCatalog,
} from '../../agent-assembly/index.ts'

import type {
  CatalogAgentInput,
  CatalogMessage,
} from '../../agent-assembly/index.ts'
import type { AgentDefinition, AgentDiagnostic, AgentRegistry, AliasRegistry } from '../../contract/index.ts'

/** One message as the pre-step waterfall carries it (identity + source only). */
export interface CatalogHostMessage {
  readonly id: string
  readonly role: string
  readonly content: readonly unknown[]
  readonly source: unknown
}

/** The waterfall's decision; only the members this adapter reads are mirrored. */
export type CatalogPreStepDecision =
  | { readonly kind: 'reject' }
  | {
    readonly kind: 'enter'
    readonly messages: readonly CatalogHostMessage[]
    readonly startsRequestSeries?: true
  }

/** One top-level or subagent session header slice. */
export interface CatalogHostHeader {
  readonly cwd?: string | undefined
  /** `subagent` marks a child session; presence alone must not be used. */
  readonly origin?: 'subagent' | undefined
  /** Non-zero for a child session; absent (zero) for a top-level session. */
  readonly delegationDepth?: number | undefined
}

/** The session slice the catalog reads. */
export interface CatalogHostSession {
  readonly header: CatalogHostHeader
  /** Supported visible-history read; returns the frozen derived transcript. */
  deriveMessages(): readonly CatalogHostMessage[]
}

/** One live Agent handle. */
export interface CatalogHostAgent {
  readonly id: string
  /** Agent-scoped Context; `agentPresets.composedPreset` takes exactly this. */
  readonly ctx: unknown
  readonly session: CatalogHostSession
}

/** The pre-step waterfall payload this listener reads. */
export interface CatalogPreStepPayload {
  readonly agent: CatalogHostAgent
  readonly messages: readonly CatalogHostMessage[]
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
  readonly modelSelection: unknown
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The host's pre-step waterfall; this bundle's listener wraps `next()`.
     * Declared locally because the host package is type-only externally
     * vendored and never imported (ADR-0001).
     */
    'agent/pre-step'(
      this: unknown,
      payload: CatalogPreStepPayload,
      next: () => Promise<CatalogPreStepDecision>,
    ): Promise<CatalogPreStepDecision>
  }
}

/** The host working-directory service slice. */
interface HostWorkingDirectory {
  ensure(agent: CatalogHostAgent, signal: AbortSignal): Promise<string>
}

/** The host tools service slice; the argument is the viewing scope (the agent). */
interface HostTools {
  schemas(scope: CatalogHostAgent): readonly { readonly name: string }[]
}

/** The host skills service slice. */
interface HostSkills {
  snapshot(options: {
    readonly cwd: string | undefined
    readonly signal: AbortSignal
    readonly scope: CatalogHostAgent
  }): Promise<{ readonly skills: readonly { readonly name: string }[]; readonly complete: boolean }>
}

/** The host preset service slice. */
interface HostAgentPresets {
  composedPreset(ctx: unknown): string | undefined
}

/** Construction dependencies: the two registries the core row already owns. */
export interface CatalogInstallDependencies {
  readonly agentRegistry: AgentRegistry
  readonly aliasRegistry: AliasRegistry
  /** One-line diagnostic sink; undefined discards the warning. */
  readonly warn?: ((message: string) => void) | undefined
}

/** Production digest: SHA-256 over the canonical catalog text, hex encoded. */
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Install the catalog listener on the core row's context.
 *
 * The listener is effect-bound to the row (Cordis disposes it on unload) and
 * serves every top-level Agent; subagent sessions return the untouched
 * decision. Returns the raw disposer for tests that mount the row directly.
 */
export function installAgentCatalog(ctx: Context, dependencies: CatalogInstallDependencies): () => boolean {
  return ctx.on('agent/pre-step', async (payload, next) => {
    // Waterfall contract: the bundle must delegate first, and a rejected step
    // keeps its rejection verbatim.
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const { agent, signal } = payload
    if (!isTopLevel(agent)) return decision
    signal.throwIfAborted()
    // At most one warning per step, even when a fallback and a later probe both fail.
    const warn = warnOnce(dependencies.warn)
    try {
      return await publishCatalog(ctx, dependencies, agent, signal, decision, warn)
    } catch (error) {
      // Cancellation is the caller's signal, never a catalog failure.
      if (signal.aborted) throw error
      warn(`agent catalog skipped: ${errorMessage(error)}`)
      return decision
    }
  })
}

/** Whether this session owns a catalog (top-level sessions only). */
function isTopLevel(agent: CatalogHostAgent): boolean {
  const header = agent.session.header
  return header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0
}

/** One step's catalog work: every probe here is advisory. */
async function publishCatalog(
  ctx: Context,
  dependencies: CatalogInstallDependencies,
  agent: CatalogHostAgent,
  signal: AbortSignal,
  decision: Extract<CatalogPreStepDecision, { readonly kind: 'enter' }>,
  warn: (message: string) => void,
): Promise<CatalogPreStepDecision> {
  const cwd = await resolveCwd(ctx, agent, signal, warn)
  signal.throwIfAborted()
  // One read of each frozen registry face; the registries memoise per cwd.
  const [agents, aliasSnapshot, agentDiagnostics, aliasDiagnostics] = await Promise.all([
    dependencies.agentRegistry.list({ cwd, signal }),
    dependencies.aliasRegistry.snapshot({ cwd, signal }),
    dependencies.agentRegistry.diagnostics({ cwd }),
    dependencies.aliasRegistry.diagnostics({ cwd }),
  ])
  signal.throwIfAborted()

  const missing = await probeWarnings(ctx, agent, cwd, signal, agents)
  signal.throwIfAborted()
  const mode = readPresetMode(ctx, agent)
  signal.throwIfAborted()

  const incomplete = missing.incomplete
    || agentDiagnostics.some((diagnostic) => diagnosticHidesAgent(diagnostic))
    || aliasDiagnostics.length > 0

  const snapshot = projectCatalog({
    agents: agents.map((definition): CatalogAgentInput => ({
      agentName: definition.agentName,
      name: definition.name,
      description: definition.description,
      ...definition.modelOrder === undefined ? {} : { modelOrder: definition.modelOrder },
      missingTools: missing.missingTools.get(definition.agentName) ?? [],
      missingSkills: missing.missingSkills.get(definition.agentName) ?? [],
    })),
    aliases: aliasSnapshot.aliases.map((alias) => alias.alias),
    ...mode === undefined ? {} : { mode },
    incomplete,
  })
  const digest = catalogDigest(snapshot, sha256)
  const batch = lastCatalog(decision.messages)
  const visible = visibleCatalog(agent)
  const plan = planCatalogPublish({
    digest,
    ...batch === undefined ? {} : { batchDigest: batch.digest },
    ...visible === undefined ? {} : { visibleDigest: visible.digest },
    newIsEmpty: snapshot.entries.length === 0,
  })

  if (plan.action === 'keep') return decision
  if (plan.action === 'remove') {
    return batch === undefined
      ? decision
      : { ...decision, messages: decision.messages.filter((message) => message.id !== batch.id) }
  }

  const message: CatalogMessage = createCatalogMessage({ snapshot, update: plan.update, id: randomUUID() })
  if (plan.action === 'replace') {
    return batch === undefined
      ? decision
      : {
        ...decision,
        messages: decision.messages.map((candidate) => candidate.id === batch.id ? message : candidate),
      }
  }
  // Placement matches the reference implementation: after every inherited
  // runtime-context message, as the step's last admitted message.
  return { ...decision, messages: [...decision.messages, message] }
}

/** Resolve the workspace: the host service first, then the session header. */
async function resolveCwd(
  ctx: Context,
  agent: CatalogHostAgent,
  signal: AbortSignal,
  warn: ((message: string) => void) | undefined,
): Promise<string | undefined> {
  const service = callableService<HostWorkingDirectory>(ctx, 'workingDirectory', 'ensure')
  if (service !== undefined) {
    try {
      const cwd = await service.ensure(agent, signal)
      signal.throwIfAborted()
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch (error) {
      // Advisory fallback, except for cancellation which must propagate. The
      // console stays honest about the degraded source; the header still gives
      // the registries a cwd to scan.
      if (signal.aborted) throw error
      warn?.(`agent catalog working directory unavailable: ${errorMessage(error)}; using the session header`)
    }
  }
  return agent.session.header.cwd
}

/** Effective-surface warnings: missing tools and missing preset skills. */
async function probeWarnings(
  ctx: Context,
  agent: CatalogHostAgent,
  cwd: string | undefined,
  signal: AbortSignal,
  agents: readonly AgentDefinition[],
): Promise<{
  readonly missingTools: ReadonlyMap<string, readonly string[]>
  readonly missingSkills: ReadonlyMap<string, readonly string[]>
  readonly incomplete: boolean
}> {
  const missingTools = new Map<string, readonly string[]>()
  const missingSkills = new Map<string, readonly string[]>()
  let incomplete = false

  const tools = callableService<HostTools>(ctx, 'tools', 'schemas')
  if (tools !== undefined) {
    const names = new Set(tools.schemas(agent).map((schema) => schema.name))
    for (const agent of agents) {
      const absent = missingNames(agent.requiredTools, names)
      if (absent.length > 0) missingTools.set(agent.agentName, absent)
    }
  }

  const skills = callableService<HostSkills>(ctx, 'skills', 'snapshot')
  if (skills !== undefined) {
    const snapshot = await skills.snapshot({ cwd, signal, scope: agent })
    signal.throwIfAborted()
    if (snapshot.complete === false || !Array.isArray(snapshot.skills)) {
      // Never assert absence over an incomplete discovery; only say so.
      incomplete = true
    } else {
      const names = new Set(snapshot.skills.map((skill) => skill.name))
      for (const agent of agents) {
        const absent = missingNames(agent.skills, names)
        if (absent.length > 0) missingSkills.set(agent.agentName, absent)
      }
    }
  }
  return { missingTools, missingSkills, incomplete }
}

/** Read the current preset id through the Agent's scoped context. */
function readPresetMode(ctx: Context, agent: CatalogHostAgent): string | undefined {
  const presets = callableService<HostAgentPresets>(ctx, 'agentPresets', 'composedPreset')
  if (presets === undefined) return undefined
  const mode = presets.composedPreset(agent.ctx)
  return typeof mode === 'string' && mode !== '' ? mode : undefined
}

/** The latest catalog message visible through the supported derived history. */
function visibleCatalog(agent: CatalogHostAgent): { readonly digest: string } | undefined {
  return lastCatalog(agent.session.deriveMessages())
}

/** Scan backwards for the newest readable catalog message. */
function lastCatalog(
  messages: readonly CatalogHostMessage[],
): { readonly id: string; readonly digest: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'user') continue
    // An unreadable or foreign source is not this plugin's catalog: skip it.
    const digest = digestCatalogSource(message.source, sha256)
    if (digest === undefined) continue
    return { id: message.id, digest }
  }
  return undefined
}

/**
 * Diagnostic codes that hide an agent from the listing. The two resolved
 * markers (unexpected id, no model order) leave the definition visible.
 */
function diagnosticHidesAgent(diagnostic: AgentDiagnostic): boolean {
  return diagnostic.code !== 'unexpected-id' && diagnostic.code !== 'no-model-order'
}

/** Read one host service and require its entry method; absent reads as undefined. */
function callableService<T>(ctx: Context, name: string, method: keyof T & string): T | undefined {
  const candidate: unknown = ctx.get(name)
  if (typeof candidate !== 'object' || candidate === null) return undefined
  return typeof (candidate as Record<string, unknown>)[method] === 'function' ? candidate as T : undefined
}

/** Declared names missing from an available set, in stable order. */
function missingNames(
  declared: readonly string[] | undefined,
  available: ReadonlySet<string>,
): readonly string[] {
  return (declared ?? []).filter((name) => !available.has(name)).sort()
}

/** Forward the first warning only, so one degraded step does not double-report. */
function warnOnce(sink: ((message: string) => void) | undefined): (message: string) => void {
  let warned = false
  return (message) => {
    if (warned) return
    warned = true
    sink?.(message)
  }
}

/** One-line error text safe for the log. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

