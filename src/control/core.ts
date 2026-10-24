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

import type { AgentRegistry, AliasRegistry, ChainResolution, ModelSelectionPolicy } from '../contract/index.ts'
import type { ControlFileSystem } from '../core/ports.ts'
import { errorMessage, UnknownAgentError } from './client-errors.ts'
import { composeAgentDocument } from './compose.ts'
import { applyRegistryEdit, type RegistryEditContext } from './registry-edit.ts'
import { sessionChainContext } from './resolve.ts'
import type { ComposeSessionOptions, ComposedAgentSession } from './session.ts'
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
}

/** The control face: six members, everything else is inside. */
export interface ControlCore {
  /** One read that returns everything a settings view renders. */
  snapshot(options?: { readonly cwd?: string | undefined }): Promise<ControlSnapshot>
  /** One agent document as the editor reads it; throws when the agent (or its file) is gone. */
  compose(agentName: string, options?: { readonly cwd?: string | undefined }): Promise<ComposedAgentDocument>
  /** Pure: edits → per-file write plan plus rejections. No I/O. */
  plan(doc: ComposedAgentDocument, edits: readonly DocumentEdit[]): WritePlan
  /** Atomic commit of a plan; never throws, one result row per file. */
  commit(plan: WritePlan): Promise<WriteReport>
  /** One registry tuning edit, landed in exactly one layer file. */
  applyRegistryEdit(edit: RegistryEdit): Promise<WriteReport>
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
}

/** Create the control core over the two registries and the write port. */
export function createControlCore(dependencies: ControlDependencies): ControlCore {
  const resolveProjectRoot = (): string | undefined => dependencies.resolveProjectRoot?.()

  return {
    async snapshot(options) {
      const cwd = options?.cwd ?? resolveProjectRoot()
      const [agents, aliasSnapshot, agentDiagnostics, aliasDiagnostics] = await Promise.all([
        dependencies.agentRegistry.list({ cwd }),
        dependencies.aliasRegistry.snapshot({ cwd }),
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
        agentDiagnostics,
        aliasDiagnostics,
        findings,
        // Ticket 04 wires the active assembly provider into this snapshot. Until
        // then no agent has a plan, which the contract already reads as
        // "assembly unavailable" rather than an invented plan.
        assemblies: {},
      }
    },

    async compose(agentName, options) {
      const cwd = options?.cwd ?? resolveProjectRoot()
      const definition = await dependencies.agentRegistry.get(agentName, { cwd })
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

    applyRegistryEdit(edit) {
      const context: RegistryEditContext = {
        aliasRegistry: dependencies.aliasRegistry,
        fileSystem: dependencies.fileSystem,
        resolveProjectRoot,
        dshHome: dependencies.resolveDshHome(),
        warn: dependencies.warn,
      }
      return applyRegistryEdit(edit, context)
    },

    invalidate() {
      dependencies.agentRegistry.invalidate()
      dependencies.aliasRegistry.invalidate()
    },

    async composeSession(agentName, options) {
      const cwd = options?.cwd ?? resolveProjectRoot()
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
        }),
      })
      if (!resolution.ok) throw new ChainExhaustedError(resolution, refusalByPolicy(resolution))
      return composeSessionOf(definition, cwd, resolution)
    },
  }
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
  options: { readonly cwd?: string | undefined } = {},
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
