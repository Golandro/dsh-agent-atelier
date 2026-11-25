/**
 * One read-only predicate for model entries, shared by the write path and the
 * settings views (票 79 第 4 条).
 *
 * A model entry is user-editable exactly when a registry layer file declares
 * it: `setSysPrompt` / `setAvailable` / `deleteModel` resolve the *effective*
 * declaration and splice that one file, so an entry with no file — the target
 * of the built-in pointer, and the implicit `dsh-default` entry synthesised
 * when the default pair matches no declaration — has nowhere to land.
 * `path === undefined` is that condition; `source === 'built-in'` is a subset
 * of it (the built-in entry carries no path), so keying on the source alone
 * drifts the moment a second no-file source appears. The views call this
 * rather than re-deriving the rule, so a card's 只读 badge and the host's
 * `read-only` refusal can never disagree.
 */
import type { ModelDefinition } from '../contract/index.ts'

/** Whether a model entry has no registry layer file to write. */
export function isReadOnlyModelEntry(entry: Pick<ModelDefinition, 'source' | 'path'>): boolean {
  return entry.source === 'built-in' || entry.path === undefined
}
