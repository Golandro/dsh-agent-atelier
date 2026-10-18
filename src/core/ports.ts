/**
 * The filesystem port discovery reads through.
 *
 * Discovery mirrors the native skill loader's `optionalFileSystem(ctx)`
 * (`skill/skill-filesystem/src/index.ts:849`): when the host context exposes an
 * `fs` service, reads and listings go through it (so a sandboxed or remote
 * workspace is honoured); otherwise they fall back to Node's filesystem. The
 * bundled root is the exception — it is our own trusted asset, so it is read
 * through Node directly, exactly as the native loader bypasses the `fs` service
 * for `trustedHost` roots.
 *
 * The port is deliberately tiny: the discovery layer only ever lists a root,
 * reads one document, or asks whether a `.git` marker exists. Paths stay host
 * paths throughout, so no opaque target type has to leak into this bundle.
 */

/** One direct child of a listed root. */
export interface AgentDirEntry {
  readonly name: string
  readonly kind: 'file' | 'directory' | 'other'
}

/**
 * Everything discovery needs from a filesystem.
 *
 * Absence is not an error: each method reports it as `undefined`/`false` so a
 * root that does not exist yet is simply empty.
 */
export interface AgentFileSystem {
  /** Direct children of `path`, or `undefined` when `path` is not a directory. */
  listDirectory(path: string, signal?: AbortSignal): Promise<readonly AgentDirEntry[] | undefined>
  /** UTF-8 contents of a regular file, or `undefined` when it is absent or not a file. */
  readTextFile(path: string, signal?: AbortSignal): Promise<string | undefined>
  /** Whether `path` exists at all (file or directory). */
  pathExists(path: string, signal?: AbortSignal): Promise<boolean>
}
