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
 * `client-list/`, outside `src/` so the import matrix keeps treating the main
 * bundle as dependency-free) implement exactly these exports.
 */

import type { ControlSnapshot } from '../../control/index.ts'

/** Specifiers the on-demand chunk loader accepts for this package. */
export type ChunkSpecifier = './client.editor.js' | './client.list.js'

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
