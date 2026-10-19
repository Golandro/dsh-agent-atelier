/**
 * The client-facing control port (ticket 12): the six operations a settings
 * page consumes, projected as edits-in / reports-out instead of the host-side
 * `plan(doc, edits)` / `commit(plan)` pair a server holds.
 *
 * Two adapters implement this one interface — the in-memory adapter over the
 * control core (tests, demos) and the browser HTTP adapter — so ticket 13's
 * adapter contract suite can run the same spec against both. Error behaviour is
 * part of the interface: failed commits and registry edits reject with
 * {@link ControlClientError} carrying the wire status and the per-file report,
 * and an aborted call rejects with an `AbortError`.
 */
import { planDirtyEdits, type ControlCore } from './core.ts'
import { composeError, ControlClientError, reportOrThrow, throwIfAborted } from './client-errors.ts'

import type {
  ComposedAgentDocument,
  ControlSnapshot,
  DocumentEdit,
  RegistryEdit,
  WritePlan,
  WriteReport,
} from './types.ts'

/** Per-call options shared by both control client adapters. */
export interface ControlClientOptions {
  /** Workspace root the host should scan; the host default applies when omitted. */
  readonly cwd?: string | undefined
  /** Cancels an in-flight call (switching agents, closing the page, etc.). */
  readonly signal?: AbortSignal | undefined
}

/** The six operations a settings view needs; implemented by memory and HTTP. */
export interface ControlClient {
  snapshot(options?: ControlClientOptions): Promise<ControlSnapshot>
  compose(agentName: string, options?: ControlClientOptions): Promise<ComposedAgentDocument>
  /** Preview: the plan (including per-edit rejections) is data, never a write. */
  plan(agentName: string, edits: readonly DocumentEdit[], options?: ControlClientOptions): Promise<WritePlan>
  /** Commit dirty edits; rejects with `edit-rejected` when the plan refuses any edit. */
  commit(edits: readonly DocumentEdit[], options?: ControlClientOptions): Promise<WriteReport>
  applyRegistryEdit(edit: RegistryEdit, options?: ControlClientOptions): Promise<WriteReport>
  invalidate(options?: ControlClientOptions): Promise<void>
}

/** The in-memory adapter: the control core behind the client port. */
export function createMemoryControlClient(core: ControlCore): ControlClient {
  return {
    async snapshot(options) {
      throwIfAborted(options?.signal)
      return await core.snapshot({ cwd: options?.cwd })
    },

    async compose(agentName, options) {
      throwIfAborted(options?.signal)
      try {
        return await core.compose(agentName, { cwd: options?.cwd })
      } catch (error) {
        throw composeError(error)
      }
    },

    async plan(agentName, edits, options) {
      throwIfAborted(options?.signal)
      let doc: ComposedAgentDocument
      try {
        doc = await core.compose(agentName, { cwd: options?.cwd })
      } catch (error) {
        throw composeError(error)
      }
      throwIfAborted(options?.signal)
      return core.plan(doc, edits)
    },

    async commit(edits, options) {
      throwIfAborted(options?.signal)
      const plan = await planDirtyEdits(core, edits, { cwd: options?.cwd })
      throwIfAborted(options?.signal)
      if (plan.rejections.length > 0) {
        const first = plan.rejections[0]
        throw new ControlClientError(400, 'edit-rejected', first?.message ?? 'edit rejected', { rejections: plan.rejections })
      }
      return reportOrThrow(await core.commit(plan))
    },

    async applyRegistryEdit(edit, options) {
      throwIfAborted(options?.signal)
      return reportOrThrow(await core.applyRegistryEdit(edit))
    },

    async invalidate(options) {
      throwIfAborted(options?.signal)
      core.invalidate()
    },
  }
}
