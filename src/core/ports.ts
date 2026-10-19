/**
 * The filesystem ports both halves of the core read and write through.
 *
 * Discovery mirrors the native skill loader's `optionalFileSystem(ctx)`
 * (`skill/skill-filesystem/src/index.ts:849`): when the host context exposes an
 * `fs` service, reads and listings go through it (so a sandboxed or remote
 * workspace is honoured); otherwise they fall back to Node's filesystem. The
 * bundled root is the exception — it is our own trusted asset, so it is read
 * through Node directly, exactly as the native loader bypasses the `fs` service
 * for `trustedHost` roots.
 *
 * The read port is deliberately tiny: the discovery layer only ever lists a
 * root, reads one document, or asks whether a `.git` marker exists. The write
 * port (ticket 11) is primitives only — uniqueness, atomicity and permission
 * policy live in the core that sequences them, so an in-memory port can test
 * the same algorithm the Node port serves. Paths stay host paths throughout,
 * so no opaque target type has to leak into this bundle.
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

/**
 * The filesystem access both registry services share, as injected dependencies.
 *
 * `nodeFileSystem` is the fallback every user-content read goes through; the
 * host `fs` service (resolved at use time, never at plugin load, so a service
 * mounted after the registry is still honoured on the next query) wins when it
 * resolves. `warn` is the diagnostic sink; `undefined` discards the log line.
 */
export interface FileSystemDependencies {
  /** Node filesystem used as the fallback when no host `fs` port resolves. */
  readonly nodeFileSystem: AgentFileSystem
  /**
   * Resolves the host `fs` port when a query needs it; `undefined` reads
   * through Node. Called at use time, never at plugin load.
   */
  readonly resolveFileSystem?: (() => AgentFileSystem | undefined) | undefined
  /** Diagnostic sink; `undefined` discards the log line. */
  readonly warn?: ((message: string) => void) | undefined
}

/**
 * The write-capable port the control core (ticket 11) sequences atomic writes
 * over. Primitives only: the core owns the temp-name policy, the temp-then-rename
 * order and the `0600` permission, so the same commit algorithm runs against
 * Node and against the in-memory test adapter.
 *
 * Absence stays data: `readTextFile` reports a missing file as `undefined`
 * rather than throwing.
 */
export interface ControlFileSystem {
  /** UTF-8 contents of a regular file, or `undefined` when it is absent or not a file. */
  readTextFile(path: string): Promise<string | undefined>
  /** Create `path` and its parents as directories; an existing directory is fine. */
  ensureDirectory(path: string): Promise<void>
  /**
   * Create one new file holding `text` with `mode` bits, exclusively: the call
   * fails instead of overwriting. Returns the created path — the adapter owns
   * temp-name uniqueness, so the core never invents names.
   */
  writeNewFile(directory: string, text: string, mode: number): Promise<string>
  /** Move a file onto `to`, replacing it. */
  renameFile(from: string, to: string): Promise<void>
  /** Delete a file; a missing file is fine. */
  removeFile(path: string): Promise<void>
}
