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
 */
import { inspectAliasRegistry } from '../core/index.ts'

import type { AgentRegistry, AliasRegistry } from '../contract/index.ts'
import type { ControlFileSystem } from '../core/ports.ts'
import { composeAgentDocument } from './compose.ts'
import { applyRegistryEdit, type RegistryEditContext } from './registry-edit.ts'
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
      }
    },

    async compose(agentName, options) {
      const cwd = options?.cwd ?? resolveProjectRoot()
      const definition = await dependencies.agentRegistry.get(agentName, { cwd })
      if (definition === undefined) throw new Error(`unknown agent: "${agentName}"`)
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
  }
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
            message: error instanceof Error ? error.message : String(error),
            editIndex: group.firstIndex,
          })
          continue
        }
        const planned = core.plan(doc, group.edits)
        entries.push(...planned.entries)
        rejections.push(...planned.rejections)
      }
      return await core.commit({ entries, rejections })
    },
    invalidate: () => core.invalidate(),
  }
}
