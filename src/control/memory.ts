/**
 * The in-memory control adapter (ticket 11): the whole control core over a
 * `Map<string, string>` instead of a disk, with the *real* services wired on
 * top — the provider registry, two filesystem providers, both registries — so
 * a test that exercises compose/plan/commit runs the same scan, merge and
 * write algorithms the host runs.
 *
 * The memory filesystem implements both ports: reads and listings answer from
 * path prefixes (directories are implied by deeper keys), and the write port
 * mints unique temp names per instance. No merge, scan or serialization logic
 * is duplicated here.
 */
import { join } from 'node:path'

import { createAgentRegistryService, createAgentProviders, createAliasRegistryService } from '../core/index.ts'
import type { AgentDirEntry, AgentFileSystem, ControlFileSystem } from '../core/ports.ts'
import { createFileSystemAgentProvider } from '../providers/fs/index.ts'
import { createControlCore, type ControlCore } from './core.ts'
import type { AgentDiagnostic, AgentModelTarget } from '../contract/index.ts'

/** Construction options; every path is in-memory and never touched on disk. */
export interface InMemoryControlOptions {
  /** Workspace root the project-dsh roots hang off; `undefined` means user-level only. */
  readonly projectRoot?: string | undefined
  /** Harness home holding the user-dsh layer; defaults to a path under the project root. */
  readonly dshHome?: string | undefined
  /** Initial files, keyed by absolute-style path. */
  readonly files?: Record<string, string> | undefined
  /** Extra agent-scan diagnostics to surface in snapshots, as if the scan had found them. */
  readonly agentDiagnostics?: readonly AgentDiagnostic[] | undefined
  /** The DSH default pair the built-in `dsh-default` alias points at; `undefined` means no built-in. */
  readonly readDefaultPair?: (() => AgentModelTarget | undefined) | undefined
}

/** The in-memory core, plus direct access to its files for test assertions. */
export interface InMemoryControlCore extends ControlCore {
  readonly files: Map<string, string>
}

/** Create the in-memory control core. */
export function createInMemoryControlCore(options: InMemoryControlOptions = {}): InMemoryControlCore {
  const projectRoot = options.projectRoot
  const dshHome = options.dshHome ?? join(projectRoot ?? '/dsh-in-memory', 'dsh-home')
  const files = new Map<string, string>(Object.entries(options.files ?? {}))
  let tempCounter = 0

  const memoryFileSystem: AgentFileSystem & ControlFileSystem = {
    async listDirectory(path) {
      const prefix = `${path}/`
      const children = new Map<string, 'file' | 'directory'>()
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const name = rest.split('/', 1)[0] ?? ''
        if (name === '') continue
        children.set(name, rest.includes('/') ? 'directory' : 'file')
      }
      if (children.size === 0) return undefined
      const entries: AgentDirEntry[] = [...children].map(([name, kind]) => ({ name, kind }))
      return entries.sort((left, right) => left.name.localeCompare(right.name))
    },

    async readTextFile(path) {
      return files.get(path)
    },

    async pathExists(path) {
      if (files.has(path)) return true
      const prefix = `${path}/`
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) return true
      }
      return false
    },

    async ensureDirectory() {
      // Directories are implied by the keys beneath them.
    },

    async writeNewFile(directory, text) {
      // Dot-prefixed, so an in-flight temp file never looks like an agent entry.
      const tempPath = join(directory, `.commit-${Date.now().toString(36)}-${(tempCounter += 1)}`)
      if (files.has(tempPath)) throw new Error(`temp file name collision: ${tempPath}`)
      files.set(tempPath, text)
      return tempPath
    },

    async renameFile(from, to) {
      const text = files.get(from)
      if (text === undefined) throw new Error(`rename source is missing: ${from}`)
      files.set(to, text)
      files.delete(from)
    },

    async removeFile(path) {
      files.delete(path)
    },
  }

  const providers = createAgentProviders()
  providers.registerAgentProvider(() =>
    createFileSystemAgentProvider({
      id: 'project-dsh',
      source: 'project-dsh',
      rank: 0,
      trust: 'untrusted',
      origin: 'user',
      resolveRoot: (root) => (root === undefined ? undefined : join(root, '.dsh', 'agents')),
      selectFileSystem: () => memoryFileSystem,
    }),
  )
  providers.registerAgentProvider(() =>
    createFileSystemAgentProvider({
      id: 'user-dsh',
      source: 'user-dsh',
      rank: 1,
      trust: 'untrusted',
      origin: 'user',
      resolveRoot: () => join(dshHome, 'agents'),
      selectFileSystem: () => memoryFileSystem,
    }),
  )

  const core = createControlCore({
    agentRegistry: createAgentRegistryService({ providers, nodeFileSystem: memoryFileSystem }),
    aliasRegistry: createAliasRegistryService({ nodeFileSystem: memoryFileSystem, readDefaultPair: options.readDefaultPair }, { dshHome }),
    fileSystem: memoryFileSystem,
    resolveProjectRoot: () => projectRoot,
    resolveDshHome: () => dshHome,
  })

  const injected = options.agentDiagnostics ?? []
  return {
    ...core,
    async snapshot(snapshotOptions) {
      const snapshot = await core.snapshot(snapshotOptions)
      if (injected.length === 0) return snapshot
      return {
        ...snapshot,
        agentDiagnostics: [...snapshot.agentDiagnostics, ...injected],
        findings: [...snapshot.findings, ...injected.map((diagnostic) => ({ origin: 'agent-scan' as const, diagnostic }))],
      }
    },
    files,
  }
}
