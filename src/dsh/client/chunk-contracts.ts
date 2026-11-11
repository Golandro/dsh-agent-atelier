/**
 * Package-local dynamic chunk contracts (ticket 05).
 *
 * The main client bundle stays a light shell: the CodeMirror editor surface and
 * the TanStack list view ship as package-local chunks — `lib/client.editor.js`
 * and `lib/client.list.js` — that the module loader loads on demand through
 * `require.async('./client.<name>.js')` (DSH `client/modules` `client/system.ts`:
 * `CLIENT_CHUNK` name rule + `importChunk` script-tag channel; the chunk file
 * registers itself via `window.__ModuleLoader__.load({ id, chunk, factory })`).
 *
 * Both artifacts are self-contained browser builds produced by
 * `scripts/build-chunks.mjs` (Q4 ruling 2026-10-19: browser release artifact,
 * local, no CDN, fully lazy). The editor chunk is react-free; the list chunk's
 * only external is the platform-provided `react`. Every static relative
 * dependency lives inside its owning chunk — chunks never reach back into the
 * main bundle, so the types below are the whole shared surface.
 *
 * These files are the coordination seam: the main bundle consumes the chunks
 * only through these shapes, and the chunk sources (`client-editor/`,
 * `client-list/`, `client-registry/`, outside `src/` so the import matrix keeps
 * treating the main bundle as dependency-free) implement exactly these exports.
 */

import type { AliasRegistrySource } from '../../contract/index.ts'
import type { ControlSnapshot, RegistryEdit, WriteFailureCode, WriteResult } from '../../control/index.ts'

/** Specifiers the on-demand chunk loader accepts for this package. */
export type ChunkSpecifier = './client.editor.js' | './client.list.js' | './client.registry.js'

/** Editable block kind the editor chunk renders (v1 ruling: no clip rows). */
export type EditorBlockKind = 'frontmatter' | 'prose'

/**
 * One editable block of the composed document, byte-exact per ticket 11
 * (`ComposedBlock`): the frontmatter block is the raw text between the fences,
 * the prose block is the raw body.
 */
export interface EditorBlock {
  readonly id: string
  readonly kind: EditorBlockKind
  readonly text: string
}

/**
 * Fence framing of the composed document (ticket 11 `DocumentFraming`). The
 * editor lays the document out as `opening + blocks + closing`, keeps the
 * fence lines visible but structurally protected, and maps each block's range
 * inside the combined text.
 */
export type EditorFraming =
  | { readonly kind: 'plain' }
  | { readonly kind: 'fenced'; readonly opening: string; readonly closing: string }

/** Creation options for the imperative CodeMirror document editor. */
export interface DocumentEditorOptions {
  readonly agentName: string
  readonly framing: EditorFraming
  readonly blocks: readonly EditorBlock[]
  /** Unsaved per-block texts; a block without a draft shows its saved text. */
  readonly drafts: Readonly<Record<string, string>>
  readonly readonly?: boolean
  /** Live per-block text after user edits (never fired for external syncs). */
  onDraftText(blockId: string, text: string): void
  /** Per-block save requested from a block header. */
  onSaveBlock(blockId: string): void
  /** Per-block revert requested from a block header. */
  onRevertBlock(blockId: string): void
}

/** Imperative handle to the mounted CodeMirror editor. */
export interface DocumentEditorHandle {
  /**
   * Reconcile external state (saved block texts, drafts, structure swap):
   * drafts win where present, everything else snaps to the saved text.
   */
  sync(options: DocumentEditorOptions): void
  destroy(): void
}

/** Editor chunk exports (`lib/client.editor.js`). */
export interface EditorChunk {
  createDocumentEditor(container: HTMLElement, options: DocumentEditorOptions): DocumentEditorHandle
}

/** Kind of entity a cross-page focus request points at (ticket 60). */
export type PanelFocusKind = 'model' | 'alias' | 'agent'

/**
 * One cross-page focus target (ticket 60): an entity the receiving page
 * should locate. `source` pins the registry layer the target was seen in
 * (model / alias only); absent means the merged face. The page that cannot
 * find the target in its current space switches to the merged space itself —
 * the space segment is page-owned, the shell only routes and holds the target.
 */
export interface PanelFocus {
  readonly kind: PanelFocusKind
  readonly name: string
  readonly source?: AliasRegistrySource | undefined
}

/** Registry page a focus request lands on (ticket 60). */
export type RegistryDestination = 'models' | 'prompts'

/** Props for the lazy list view (the prototype's `AgentListProps`). */
export interface AgentListViewProps {
  readonly snapshot: ControlSnapshot
  /** Selected agent name; `null` clears the selection. */
  readonly selected: string | null
  onSelect(agentName: string | null): void
}

/** List chunk exports (`lib/client.list.js`): a React component. */
export interface ListChunk {
  readonly AgentListView: (props: AgentListViewProps) => unknown
}

/**
 * Failure vocabulary of one registry write row (ticket 62): the host's
 * `WriteFailureCode` set plus exactly one client-only cause — a transport
 * failure that never reached the host. Host messages stay verbatim; this
 * vocabulary is the only thing the UI switches on.
 */
export type RegistryWriteFailureCode = WriteFailureCode | 'network'

type RegistryWriteSuccess = Extract<WriteResult, { ok: true }>
type RegistryWriteFailure = Extract<WriteResult, { ok: false }>

/**
 * One row of a registry write outcome, one per host result row in batch order.
 * The success/failure shapes derive from the control `WriteResult`; only the
 * failure code is widened by the one client-only cause. A failed row's `file`
 * is undefined when the host refused the edit before resolving one.
 */
export type RegistryWriteRow =
  | (RegistryWriteSuccess & { readonly editIndex: number })
  | (Omit<RegistryWriteFailure, 'code'> & {
      readonly editIndex: number
      readonly code: RegistryWriteFailureCode
    })

/**
 * The result of one registry write batch (ticket 62). `status` describes the
 * write rows only: `ok` means every row succeeded, `partial` some succeeded
 * but at least one failed, `failed` none succeeded, `busy` nothing was sent
 * because another batch is in flight.
 * `reloadError` is separate: the writes landed but the post-write read-back
 * failed; `snapshot` is present only when the read-back succeeded.
 */
export interface RegistryWriteOutcome {
  readonly status: 'ok' | 'partial' | 'failed' | 'busy'
  readonly rows: readonly RegistryWriteRow[]
  /** Number of successful result rows in this batch. */
  readonly changedCount: number
  /** Set when writes landed but the one post-write read-back failed. */
  readonly reloadError?: string | undefined
  /** The snapshot produced by the one read-back; absent when it failed or was skipped. */
  readonly snapshot?: ControlSnapshot | undefined
}

/**
 * Apply one or more registry edits through the single client write channel.
 * Write failures are data in the outcome; the promise rejects only for an
 * abort. Views without this callback stay read-only.
 */
export type RegistryWriteHandler = (edits: readonly RegistryEdit[]) => Promise<RegistryWriteOutcome>

/**
 * Props the lazy registry views render from (ticket 59). The seam carries
 * **pure data plus `on*` callbacks only**: the host-resolved snapshot, never a
 * client/service object, and never a re-merge (the host already resolved
 * layers; `registryLayers` is the layered projection). Page-specific state and
 * callbacks land with their pages (tickets 63/68), which extend this shape.
 */
export interface RegistryViewProps {
  readonly snapshot: ControlSnapshot
  /**
   * Pending focus target routed to this page (ticket 60). The page locates it
   * (scroll + highlight) and then calls `onFocusConsumed()`; the shell clears
   * the pending target only on that acknowledgement. A target outside the
   * page's current space makes the page switch to the merged space first.
   */
  readonly focus?: PanelFocus | null | undefined
  /** Acknowledge that `focus` was located; the shell clears the pending target. */
  onFocusConsumed?: (() => void) | undefined
  /**
   * Originate a cross-page jump (ticket 60): the shell routes by target kind
   * (model → prompts by default, alias → models, agent → agents) and hands the
   * pending target to the destination page. `destination` overrides the
   * default for a model (e.g. focus the model row on the models page).
   */
  onRequestFocus?: ((focus: PanelFocus, destination?: RegistryDestination) => void) | undefined
  /**
   * Apply one or more registry edits through the single client write channel
   * (ticket 62). Absent means the view renders read-only; a missing handler is
   * the only read-only signal the chunk needs.
   */
  readonly onRegistryWrite?: RegistryWriteHandler | undefined
  /** True while a registry write batch is in flight; views disable write affordances. */
  readonly registryWriteBusy?: boolean | undefined
}

/**
 * Registry chunk exports (`lib/client.registry.js`): the two registry pages
 * (模型关联 / 系统提示词) share one chunk and therefore one load.
 */
export interface RegistryChunk {
  readonly ModelRegistryView: (props: RegistryViewProps) => unknown
  readonly PromptRegistryView: (props: RegistryViewProps) => unknown
}
