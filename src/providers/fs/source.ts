/**
 * File-system source provider: one instance reads one root (ticket 18).
 *
 * The provider is a pure source adapter: it lists the raw direct children of
 * its root and reads one standard document per listed entry — no filtering, no
 * frontmatter parsing, no rank or trust decisions; those stay in the registry.
 * The root is handed in per query through `resolveRoot` (the provider never
 * resolves the project root, reads env, or touches `homedir`), and the
 * filesystem port is picked at use time through `selectFileSystem` — trusted
 * bundled roots pin Node, project and user roots resolve the host `fs` and
 * fall back to Node.
 */
import { join } from 'node:path'

import { SERVICE_API_VERSION } from '../../contract/index.ts'

import type { AgentFileSystem } from '../../core/ports.ts'
import type {
  AgentOrigin,
  AgentSource,
  AgentSourceProvider,
} from '../../contract/index.ts'

/** Construction options of {@link createFileSystemAgentProvider}. */
export interface FileSystemAgentProviderOptions {
  readonly id: string
  readonly source: AgentSource
  /** Lower merges earlier; ties keep registration order. */
  readonly rank: number
  /** Trusted providers hold our own assets: their failures are hard errors. */
  readonly trust: 'trusted' | 'untrusted'
  readonly origin: AgentOrigin
  /**
   * Resolves the root this provider reads for one query, from the project root
   * the registry resolved; `undefined` skips the provider for that query.
   */
  readonly resolveRoot: (projectRoot: string | undefined) => string | undefined
  /** Picks the filesystem port at use time, per list and per read. */
  readonly selectFileSystem: () => AgentFileSystem
}

export function createFileSystemAgentProvider(options: FileSystemAgentProviderOptions): AgentSourceProvider {
  return {
    id: options.id,
    source: options.source,
    rank: options.rank,
    trust: options.trust,
    origin: options.origin,
    format: 'agent-md',
    apiVersion: SERVICE_API_VERSION,
    async listEntries(lookup) {
      const root = options.resolveRoot(lookup.projectRoot)
      if (root === undefined) return undefined
      const entries = await options.selectFileSystem().listDirectory(root, lookup.signal)
      if (entries === undefined) return undefined
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        path: join(root, entry.name),
        providerId: options.id,
      }))
    },
    async readDocument(entry, lookup) {
      // The document path derives from the listed entry — the provider already
      // resolved the root when listing, so the path is never re-guessed.
      const documentPath = join(entry.path, `${entry.name}.agent.md`)
      const text = await options.selectFileSystem().readTextFile(documentPath, lookup.signal)
      if (text === undefined) {
        // The port collapses "not there" and "not a file" into absence; typed
        // read results are a follow-up ticket, so every miss reports `absent`.
        return { kind: 'missing', path: documentPath, reason: 'absent' }
      }
      return { kind: 'text', document: { path: documentPath, text } }
    },
  }
}
