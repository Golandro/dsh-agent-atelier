/**
 * The control core (ticket 11): the deep module the settings UI talks to, six
 * members over the whole write surface. Everything domain-shaped hides behind
 * this face — layer resolution and delete fallback for registry edits, block
 * routing and fence synthesis for documents, conflict detection and atomic
 * rename for commits, and the one normalized findings list.
 *
 * The {@link AgentDocPort} is the wiring seam ticket 12 binds components to:
 * same reads, but `commit(dirty)` takes the editor's edit list instead of a
 * plan, grouping the edits per agent and planning one write per document.
 *
 * Ticket 19 (#32) adds one optional seventh member, {@link ControlCore.composeSession}:
 * the session-start path, where the same core reads an agent document and the
 * registry snapshot *once* and hands them to the frozen chain engine (ticket
 * 03). The six members of ticket 11 stay as they were — the addition is a new
 * member, never a change to an existing one, so every consumer keeps the exact
 * shapes it froze.
 */
import { inspectAliasRegistry, resolveModelChain } from '../core/index.ts'

import type {
  AgentAssembly,
  AgentDefinition,
  AgentRegistry,
  AliasRegistry,
  AliasRegistrySnapshot,
  AssemblyPlan,
  ChainResolution,
  ModelSelectionPolicy,
} from '../contract/index.ts'
import type { ControlFileSystem } from '../core/ports.ts'
import { errorMessage, UnknownAgentError } from './client-errors.ts'
import { composeAgentDocument } from './compose.ts'
import { applyRegistryEdit, type RegistryEditContext } from './registry-edit.ts'
import { sessionChainContext } from './resolve.ts'
import type { AgentChainReport, ChainReportOptions, ComposeSessionOptions, ComposedAgentSession } from './session.ts'
import { ChainExhaustedError, chainInputOf, composeSessionOf } from './session-agent.ts'
import { commitPlan, planDocumentEdits } from './writes.ts'
import type {
  ComposedAgentDocument,
  ControlFinding,
  ControlSnapshot,
  DocumentEdit,
  RegistryEdit,
  WritePlan,
  WritePlanEntry,
  WriteReport,
  WriteRejection,
} from './types.ts'

/** Host-side access injected into the control core. */
export interface ControlDependencies {
  readonly agentRegistry: AgentRegistry
  readonly aliasRegistry: AliasRegistry
  /** Write port; reads go through it too, so one adapter serves both. */
  readonly fileSystem: ControlFileSystem
  /** Resolves the workspace root at use time; `undefined` means user-level only. */
  readonly resolveProjectRoot?: (() => string | undefined) | undefined
  /**
   * Resolves the project root an explicit workspace cwd would be scanned
   * under — the same walk the registries perform. The snapshot reports it so
   * the panel can say which project layer an answer actually came from.
   * Absent means the host cannot walk; the requested cwd is reported as the
   * project root. Called only for an explicit cwd, never the host default.
   */
  readonly resolveProjectRootFor?: ((cwd: string) => Promise<string | undefined>) | undefined
  readonly resolveDshHome: () => string
  /** Diagnostic sink; `undefined` discards the log line. */
  readonly warn?: ((message: string) => void) | undefined
  /**
   * The host setting's route allowlist (ticket 19 / #32, spec §5.3-2), read at
   * use time rather than captured: the setting can change while the plugin is
   * mounted, and a policy resolved in `apply()` would keep a stale list. Absent
   * — or returning `undefined` — means no allowlist: every route is allowed,
   * exactly the engine's own default. A per-call `policy` wins over this.
   */
  readonly resolveSelectionPolicy?: (() => ModelSelectionPolicy | undefined) | undefined
  /**
   * The active assembly service (ticket 04), read at use time: the assembly row
   * may mount after this row, and the panel must see whichever provider is
   * actually serving. Absent — or the service not mounted — means an empty
   * `assemblies` projection, never a second planning path.
   */
  readonly resolveAssembly?: (() => AgentAssembly | undefined) | undefined
}

/** The control face: six members, everything else is inside. */
export interface ControlCore {
  /**
   * One read that returns everything a settings view renders.
   *
   * `cwd` is a scan starting point, never an identity (ticket 37): `null`
   * means user-global (no project layer), a string is walked up to its project
   * root, and `undefined` falls back to the host default.
   */
  snapshot(options?: { readonly cwd?: string | null | undefined }): Promise<ControlSnapshot>
  /** One agent document as the editor reads it; throws when the agent (or its file) is gone. */
  compose(agentName: string, options?: { readonly cwd?: string | null | undefined }): Promise<ComposedAgentDocument>
  /** Pure: edits → per-file write plan plus rejections. No I/O. */
  plan(doc: ComposedAgentDocument, edits: readonly DocumentEdit[]): WritePlan
  /** Atomic commit of a plan; never throws, one result row per file. */
  commit(plan: WritePlan): Promise<WriteReport>
  /**
   * One registry tuning edit, landed in exactly one layer file. `cwd` picks the
   * workspace whose `project-dsh` layer is meant (ticket 37); `null` means
   * user-global, so a project-layer edit is refused as unavailable.
   */
  applyRegistryEdit(edit: RegistryEdit, options?: { readonly cwd?: string | null | undefined }): Promise<WriteReport>
  /** Drop the memoised reads; the next query rescans. */
  invalidate(): void
  /**
   * Session start (ticket 19): one agent document + one registry snapshot, read
   * once through the injected registries, resolved by the frozen chain engine
   * into the parameters a child Agent is started with.
   *
   * Unlike {@link ControlCore.compose}, this path **throws** the engine's
   * `chain-exhausted` hard error (message and report echoed by the engine,
   * unrewritten): running out of model is a hard error by contract, not a
   * document-editing concern. A single route refused by the host's allowlist
   * is flagged on the error as `notAllowed`, so a caller can tell its own
   * setting from the registry's switch without parsing the message. An agent
   * that declares no alias still goes through the engine — its raw `model:`
   * chain resolves as the escape hatch it is, and a document with neither says
   * so in the engine's own message — so there is never a second resolution
   * path to keep in step.
   */
  composeSession(agentName: string, options?: ComposeSessionOptions): Promise<ComposedAgentSession>
  /**
   * One agent's chain resolution **as data** (ticket 58): the same document,
   * snapshot, policy and engine call as {@link ControlCore.composeSession}, but
   * a chain that ran out comes back as `exhausted: true` with the report instead
   * of throwing. That is what lets a settings view echo not-reached / skipped /
   * health without running the engine itself. Unknown agents still throw
   * `UnknownAgentError`; that is the only failure not carried as data here.
   */
  chainReport(agentName: string, options?: ChainReportOptions): Promise<AgentChainReport>
}

/** One resolved call scope: what to scan, what was asked for, where it came from. */
interface ResolvedScope {
  readonly scanCwd: string | undefined
  readonly requestedCwd: string | null
  readonly projectRoot: string | null
}

/**
 * Resolve one call's workspace scope (ticket 37).
 *
 * `null` asks for user-global explicitly; `undefined` means "no explicit
 * scope" and falls back to the host default. The host default itself may be
 * absent, which is user-global too. An explicit cwd is walked by the injected
 * resolver so the reported project root is exactly the one the registries
 * scan (they share the walk), and a directory that is gone reports no project
 * root instead of a phantom one.
 */
async function resolveScope(
  dependencies: ControlDependencies,
  options: { readonly cwd?: string | null | undefined } | undefined,
): Promise<ResolvedScope> {
  const requested = options?.cwd === null
    ? null
    : (options?.cwd ?? dependencies.resolveProjectRoot?.() ?? null)
  if (requested === null) return { scanCwd: undefined, requestedCwd: null, projectRoot: null }
  const projectRoot = dependencies.resolveProjectRootFor === undefined
    ? requested
    : (await dependencies.resolveProjectRootFor(requested)) ?? null
  return { scanCwd: requested, requestedCwd: requested, projectRoot }
}

/** Create the control core over the two registries and the write port. */
export function createControlCore(dependencies: ControlDependencies): ControlCore {
  const resolveProjectRoot = (): string | undefined => dependencies.resolveProjectRoot?.()

  return {
    async snapshot(options) {
      const scope = await resolveScope(dependencies, options)
      const cwd = scope.scanCwd
      const [agents, aliasSnapshot, aliasLayers, agentDiagnostics, aliasDiagnostics] = await Promise.all([
        dependencies.agentRegistry.list({ cwd }),
        dependencies.aliasRegistry.snapshot({ cwd }),
        dependencies.aliasRegistry.layers({ cwd }),
        dependencies.agentRegistry.diagnostics({ cwd }),
        dependencies.aliasRegistry.diagnostics({ cwd }),
      ])
      // One normalized view; the UI renders it and never re-merges the families.
      const findings: ControlFinding[] = [
        ...agentDiagnostics.map((diagnostic) => ({ origin: 'agent-scan' as const, diagnostic })),
        ...aliasDiagnostics.map((diagnostic) => ({ origin: 'registry-layer' as const, diagnostic })),
        ...inspectAliasRegistry(aliasSnapshot, agents).map((finding) => ({ origin: 'cross-layer' as const, finding })),
      ]
      return {
        agents,
        models: aliasSnapshot.models,
        aliases: aliasSnapshot.aliases,
        // The layered projection behind the merged lists (ticket 57): both
        // surfaces came from the same memoised load, so they cannot disagree
        // about which entries a layer declared.
        registryLayers: aliasLayers,
        agentDiagnostics,
        aliasDiagnostics,
        findings,
        // The panel consumes this one projection; a missing key means the chain
        // cannot resolve (or no provider is mounted), never an invented plan.
        assemblies: await projectAssemblies(dependencies, agents, cwd),
        // What the answer was read against: the UI needs it to say "fell back to
        // user-global" and "this directory's project root is X" honestly.
        scope: { cwd: scope.requestedCwd, projectRoot: scope.projectRoot },
      }
    },

    async compose(agentName, options) {
      const { scanCwd } = await resolveScope(dependencies, options)
      const definition = await dependencies.agentRegistry.get(agentName, { cwd: scanCwd })
      if (definition === undefined) throw new UnknownAgentError(agentName)
      const baseText = await dependencies.fileSystem.readTextFile(definition.path)
      if (baseText === undefined) throw new Error(`agent document is unreadable: ${definition.path}`)
      return composeAgentDocument(definition, baseText)
    },

    plan(doc, edits) {
      return planDocumentEdits(doc, edits)
    },

    commit(plan) {
      return commitPlan(plan, dependencies.fileSystem)
    },

    async applyRegistryEdit(edit, options) {
      // The layer an edit lands in follows the *same* scope as the reads
      // (ticket 37): without this the panel would write the host process's
      // project layer no matter which workspace is selected.
      const scope = await resolveScope(dependencies, options)
      const context: RegistryEditContext = {
        aliasRegistry: dependencies.aliasRegistry,
        fileSystem: dependencies.fileSystem,
        resolveProjectRoot: () => scope.scanCwd,
        dshHome: dependencies.resolveDshHome(),
        warn: dependencies.warn,
      }
      return applyRegistryEdit(edit, context)
    },

    invalidate() {
      dependencies.agentRegistry.invalidate()
      dependencies.aliasRegistry.invalidate()
    },

    composeSession(agentName, options) {
      return composeSessionFor(dependencies, agentName, resolveProjectRoot(), options)
    },

    chainReport(agentName, options) {
      return chainReportFor(dependencies, agentName, options)
    },
  }
}

/** One resolved chain read: the document, the snapshot and the engine's answer, one generation. */
interface ResolvedAgentChain {
  readonly definition: AgentDefinition
  readonly cwd: string | undefined
  readonly snapshot: AliasRegistrySnapshot
  readonly resolution: ChainResolution
}

/**
 * The read + engine call both session consumers share (tickets 19 / 58): one
 * document and one snapshot read in parallel through the injected registries,
 * handed to the frozen chain engine with the caller's inputs. There is no
 * second resolution path; only how a failure is presented differs per caller.
 */
async function resolveAgentChain(
  dependencies: ControlDependencies,
  agentName: string,
  projectRoot: string | undefined,
  options: ComposeSessionOptions | undefined,
): Promise<ResolvedAgentChain> {
  const cwd = options?.cwd ?? projectRoot
  // One read each, in parallel: the registries memoise per root, so the
  // document and the snapshot a caller resolves against are the ones this
  // call was answered from — never a half-refreshed pair.
  const [definition, snapshot] = await Promise.all([
    dependencies.agentRegistry.get(agentName, { cwd }),
    dependencies.aliasRegistry.snapshot({ cwd }),
  ])
  if (definition === undefined) throw new UnknownAgentError(agentName)
  // The engine call: the document as it was read, the snapshot as it was
  // read, and the session inputs composed from that same snapshot — the
  // entry's own `effort` column is the base and a caller's explicit value
  // only replaces the entries it names (D7).
  const agent = chainInputOf(definition)
  const resolution = resolveModelChain({
    agent,
    snapshot,
    ...sessionChainContext({
      agent,
      snapshot,
      policy: options?.policy ?? dependencies.resolveSelectionPolicy?.(),
      flavor: options?.flavor,
      itemEffort: options?.itemEffort,
      observations: options?.observations,
      now: options?.now,
    }),
  })
  return { definition, cwd, snapshot, resolution }
}

/** One session-start resolution over the shared chain read; a failure is thrown, not returned. */
async function composeSessionFor(
  dependencies: ControlDependencies,
  agentName: string,
  projectRoot: string | undefined,
  options: ComposeSessionOptions | undefined,
): Promise<ComposedAgentSession> {
  const { definition, cwd, snapshot, resolution } = await resolveAgentChain(dependencies, agentName, projectRoot, options)
  if (!resolution.ok) throw new ChainExhaustedError(resolution, refusalByPolicy(resolution))
  return composeSessionOf(definition, cwd, resolution, snapshot)
}

/**
 * One on-demand chain report (ticket 58): the same chain read as session start,
 * with the engine's failure kept as data. The scope rule is the snapshot's —
 * `null` is user-global — so the route and the panel read the same workspace the
 * other control calls read.
 */
async function chainReportFor(
  dependencies: ControlDependencies,
  agentName: string,
  options: ChainReportOptions | undefined,
): Promise<AgentChainReport> {
  const scope = await resolveScope(dependencies, options)
  const { resolution } = await resolveAgentChain(dependencies, agentName, scope.scanCwd, { ...options, cwd: scope.scanCwd })
  return { report: resolution.report, exhausted: !resolution.ok }
}

/**
 * Project every listed agent through the active assembly service.
 *
 * Each agent is resolved once through the same session-start path
 * {@link ControlCore.composeSession} uses, so the panel's plan and a summon's
 * plan can never disagree. A chain that ran out contributes no key: that
 * agent cannot be summoned, and a missing key is how the panel says so. No
 * provider mounted means the whole projection is empty.
 */
async function projectAssemblies(
  dependencies: ControlDependencies,
  agents: readonly AgentDefinition[],
  cwd: string | undefined,
): Promise<Readonly<Partial<Record<string, AssemblyPlan>>>> {
  const assembly = dependencies.resolveAssembly?.()
  if (assembly === undefined) return {}
  const entries = await Promise.all(agents.map(async (agent): Promise<readonly [string, AssemblyPlan] | undefined> => {
    try {
      const session = await composeSessionFor(dependencies, agent.agentName, cwd, { cwd })
      return [agent.agentName, assembly.plan(session)] as const
    } catch (error) {
      // Chain exhaustion is the documented "cannot assemble" answer; anything
      // else is a defect and must not be hidden behind a missing key.
      if (error instanceof ChainExhaustedError) return undefined
      throw error
    }
  }))
  const assemblies: Partial<Record<string, AssemblyPlan>> = {}
  for (const entry of entries) {
    if (entry !== undefined) assemblies[entry[0]] = entry[1]
  }
  return assemblies
}

/** Whether any route in the failed chain was refused by the host's allowlist. */
function refusalByPolicy(resolution: Extract<ChainResolution, { readonly ok: false }>): boolean {
  return resolution.report.candidates.some((candidate) => candidate.skipped === 'not-allowed')
}

/**
 * Plan a caller's dirty edits against the *current* disk state: group them per
 * agent, compose each document, and plan one write per document.
 *
 * This is the single implementation of the edits-in → plan-out projection that
 * both {@link AgentDocPort} and ticket 12's HTTP wire consume; the route must
 * not re-group edits itself. Edits for an unknown agent become `unknown-agent`
 * rejections instead of throws.
 */
export async function planDirtyEdits(
  core: ControlCore,
  dirty: readonly DocumentEdit[],
  options: { readonly cwd?: string | null | undefined } = {},
): Promise<WritePlan> {
  const groups = new Map<string, { readonly edits: DocumentEdit[]; readonly firstIndex: number }>()
  for (let index = 0; index < dirty.length; index += 1) {
    const edit = dirty[index]
    if (edit === undefined) break
    const group = groups.get(edit.agentName)
    if (group === undefined) groups.set(edit.agentName, { edits: [edit], firstIndex: index })
    else group.edits.push(edit)
  }
  const entries: WritePlanEntry[] = []
  const rejections: WriteRejection[] = []
  for (const [agentName, group] of groups) {
    let doc: ComposedAgentDocument
    try {
      doc = await core.compose(agentName, options)
    } catch (error) {
      rejections.push({
        code: 'unknown-agent',
        message: errorMessage(error),
        editIndex: group.firstIndex,
      })
      continue
    }
    const planned = core.plan(doc, group.edits)
    entries.push(...planned.entries)
    rejections.push(...planned.rejections)
  }
  return { entries, rejections }
}

/** The wiring seam ticket 12 binds components to: reads plus a dirty-edit commit. */
export interface AgentDocPort {
  read(agentName: string): Promise<ComposedAgentDocument>
  /**
   * Commit the editor's dirty edits: grouped per agent, planned against the
   * *current* disk state (re-read here), committed in one report. Edits for an
   * unknown agent come back as `unknown-agent` rejections, never a throw.
   */
  commit(dirty: readonly DocumentEdit[]): Promise<WriteReport>
  invalidate(): void
}

/** Bind a doc port to a core (and a cwd, for the workspace the UI is looking at). */
export function createAgentDocPort(core: ControlCore, options: { readonly cwd?: string | undefined } = {}): AgentDocPort {
  return {
    read: (agentName) => core.compose(agentName, options),
    async commit(dirty) {
      return await core.commit(await planDirtyEdits(core, dirty, options))
    },
    invalidate: () => core.invalidate(),
  }
}
