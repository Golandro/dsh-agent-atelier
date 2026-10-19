/**
 * Seam to the package-local dynamic chunks (ticket 05).
 *
 * In the built main bundle, `scripts/build-client.mjs` swaps this module's
 * implementation for a forward to the module loader's on-demand chunk channel
 * (`require.async('./client.<name>.js')`), which loads `lib/client.<name>.js`
 * from the package's own resource URL and resolves it to the chunk's exports.
 * The source-level bodies below are therefore never executed — they only give
 * the out-of-tree build and `pnpm run typecheck` a concrete shape to check
 * against.
 */
import type { EditorChunk, ListChunk } from './chunk-contracts.ts'

/** Load the lazy CodeMirror editor chunk (lib/client.editor.js). */
export function loadEditorChunk(): Promise<EditorChunk> {
  throw new Error('chunk loading is only available inside the built client bundle')
}

/** Load the lazy TanStack list chunk (lib/client.list.js). */
export function loadListChunk(): Promise<ListChunk> {
  throw new Error('chunk loading is only available inside the built client bundle')
}
