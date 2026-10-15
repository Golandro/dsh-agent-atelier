/**
 * Agent discovery: the four-root search plus the bundled root, the directory
 * layout, and the lazy read model behind `ctx.agentRegistry` (ticket 01, D19–D24).
 *
 * The structure mirrors the native skill filesystem provider
 * (`skill/skill-filesystem/src/index.ts:244-263` for the root table) because the
 * native packages cannot be imported from this bundle and registering into
 * `ctx.skills` would launder agent documents into the skill read surface
 * (ADR-0001). So the root table, the rank ordering, the `{cwd, signal}` query
 * shape and `invalidate()` are copied here, while the locator is ours: native
 * skills look for `SKILL.md`, agents look for `<agent-name>/<agent-name>.agent.md`.
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { createNodeFileSystem, type AgentDirEntry, type AgentFileSystem } from './file-system.ts'
import { parseAgentDocument } from './frontmatter.ts'
import { createAgentRegistry, type AgentDefinitionContainer } from './registry.ts'

import type {
  AgentDefinition,
  AgentDiagnostic,
  AgentDiagnosticCode,
  AgentOrigin,
  AgentRegistry,
  AgentSource,
} from './types.ts'

/** Project-level root inside the workspace's `.dsh` directory. */
export const PROJECT_DSH_RANK = 100
/** Project-level root inside the workspace's `.agents` directory. */
export const PROJECT_AGENTS_RANK = 200
/** Reserved for v2 custom agent directories; nothing registers here in v1. */
export const CUSTOM_RANK = 300
/** User-level root under `$DSH_HOME`. */
export const USER_DSH_RANK = 400
/** User-level root under `$DSH_AGENTS_HOME` (default `~/.agents`). */
export const USER_AGENTS_RANK = 500
/** The bundled root, searched last and trusted. */
export const BUNDLED_AGENT_RANK = 600

/** Environment variable overriding the DeepSeek Harness home (native `DSH_HOME_ENV`). */
export const DSH_HOME_ENV = 'DSH_HOME'
/** Environment variable overriding the shared agents home (native `AGENTS_HOME_ENV`). */
export const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

/** Agent directories are lower-case kebab, exactly like native skill names. */
export const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** `default` names the built-in agent; a user directory with it is rejected. */
export const RESERVED_AGENT_NAME = 'default'

/** Diagnostic codes that flag a still-usable agent instead of hiding it. */
const ADVISORY_CODES: ReadonlySet<AgentDiagnosticCode> = new Set<AgentDiagnosticCode>(['unexpected-id', 'no-model-order'])

/** A flat document where a directory is expected. */
const MISPLACED_DOC_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.agent)?\.md$/

/** Cache key for scans that have no project root (only user and bundled roots). */
const NO_PROJECT_ROOT_KEY = ''

/** One discovery root, in ascending rank order. */
export interface AgentRoot {
  readonly path: string
  readonly source: AgentSource
  readonly rank: number
  readonly origin: AgentOrigin
  /** Trusted roots hold our own assets: their failures are hard errors (D21). */
  readonly trusted: boolean
}

/** Host-side access injected into the service. */
export interface AgentRegistryDependencies {
  /**
   * Resolves the host `fs` service port when a scan needs it; `undefined` reads
   * through Node. Called at use time, never at plugin load, so an `fs` service
   * mounted after this one is still honoured on the next scan — the native
   * `optionalFileSystem(ctx)` read (`skill/skill-filesystem/src/index.ts:849`).
   */
  readonly resolveFileSystem?: (() => AgentFileSystem | undefined) | undefined
  /** Diagnostic sink; `undefined` discards the log line. */
  readonly warn?: ((message: string) => void) | undefined
}

/** Roots and env overrides; every field is injectable so tests never touch the real homes. */
export interface AgentRegistryOptions {
  readonly dshHome?: string | undefined
  readonly agentsHome?: string | undefined
  /** Directory holding the bundled agents (this bundle's `bundled/`). */
  readonly bundledDir?: string | undefined
  /** Environment mapping for the home overrides; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined> | undefined
}

/** A trusted document could not be read; the bundled assets are broken. */
export class AgentDocumentError extends Error {
  readonly diagnostic: AgentDiagnostic

  constructor(diagnostic: AgentDiagnostic) {
    super(`trusted agent document ${diagnostic.path} failed (${diagnostic.code}): ${diagnostic.message}`)
    this.name = 'AgentDocumentError'
    this.diagnostic = diagnostic
  }
}

/** One memoised scan: both read surfaces come from the same pass. */
interface AgentScan {
  readonly container: AgentDefinitionContainer
  readonly diagnostics: readonly AgentDiagnostic[]
}

/** What one directory entry yielded. */
interface EntryResult {
  readonly definition?: AgentDefinition | undefined
  readonly diagnostics: readonly AgentDiagnostic[]
}

/**
 * Create the lazy agent registry.
 *
 * The first query for a project root scans the roots and memoises the result;
 * there is no watcher, so `invalidate()` is the only rescan trigger. Concurrent
 * queries share the in-flight scan.
 */
export function createAgentRegistryService(
  dependencies: AgentRegistryDependencies = {},
  options: AgentRegistryOptions = {},
): AgentRegistry {
  const nodeFileSystem = createNodeFileSystem()
  const resolveHostFileSystem = dependencies.resolveFileSystem
  const warn = dependencies.warn ?? (() => {})
  const env = options.env ?? process.env
  const cache = new Map<string, Promise<AgentScan>>()

  /** Trusted roots bypass the host `fs` service, like the native `trustedHost` path. */
  function fileSystemFor(trusted: boolean): AgentFileSystem {
    if (trusted) return nodeFileSystem
    return resolveHostFileSystem?.() ?? nodeFileSystem
  }

  /** The resolved root table for one query, ascending by rank. */
  function buildRoots(projectRoot: string | undefined): AgentRoot[] {
    const roots: AgentRoot[] = []
    if (projectRoot !== undefined) {
      roots.push(
        { path: join(projectRoot, '.dsh', 'agents'), source: 'project-dsh', rank: PROJECT_DSH_RANK, origin: 'user', trusted: false },
        { path: join(projectRoot, '.agents', 'agents'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, origin: 'user', trusted: false },
      )
    }
    roots.push(
      { path: join(resolveDshHome(options.dshHome, env), 'agents'), source: 'user-dsh', rank: USER_DSH_RANK, origin: 'user', trusted: false },
      { path: join(resolveAgentsHome(options.agentsHome, env), 'agents'), source: 'user-agents', rank: USER_AGENTS_RANK, origin: 'user', trusted: false },
    )
    if (options.bundledDir !== undefined) {
      roots.push({ path: options.bundledDir, source: 'bundled', rank: BUNDLED_AGENT_RANK, origin: 'built-in', trusted: true })
    }
    return roots
  }

  /** Walk the roots in rank order; the first root to claim an agent name wins. */
  async function scan(projectRoot: string | undefined): Promise<AgentScan> {
    const container = createAgentRegistry()
    const diagnostics: AgentDiagnostic[] = []
    const claimed = new Set<string>()
    for (const root of buildRoots(projectRoot)) {
      const fileSystem = fileSystemFor(root.trusted)
      const entries = await fileSystem.listDirectory(root.path)
      if (entries === undefined) continue
      const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of sorted) {
        const found = await discoverEntry(root, entry, fileSystem)
        for (const diagnostic of found.diagnostics) {
          if (root.trusted && !ADVISORY_CODES.has(diagnostic.code)) throw new AgentDocumentError(diagnostic)
          diagnostics.push(diagnostic)
          warn(`agent registry: ${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`)
        }
        if (found.definition === undefined || claimed.has(found.definition.agentName)) continue
        claimed.add(found.definition.agentName)
        container.register(found.definition)
      }
    }
    return { container, diagnostics }
  }

  /** Read one root entry: an agent, a misplaced document, or nothing at all. */
  async function discoverEntry(root: AgentRoot, entry: AgentDirEntry, fileSystem: AgentFileSystem): Promise<EntryResult> {
    const path = join(root.path, entry.name)
    if (entry.kind === 'directory') return await discoverDirectory(root, entry.name, path, fileSystem)
    if (entry.kind !== 'file') return { diagnostics: [] }
    const misplaced = MISPLACED_DOC_PATTERN.exec(entry.name)
    if (misplaced === null) return { diagnostics: [] }
    const agentName = misplaced[1] ?? entry.name
    return {
      diagnostics: [{
        path,
        code: 'misplaced-file',
        message: `flat documents are not agents; move it to ${agentName}/${agentName}.agent.md`,
        agentName,
      }],
    }
  }

  /** Read `<root>/<name>/<name>.agent.md`, or explain why it is not an agent. */
  async function discoverDirectory(root: AgentRoot, name: string, path: string, fileSystem: AgentFileSystem): Promise<EntryResult> {
    // Dotted entries (`.git`, `.system`, …) are host bookkeeping, not candidates.
    if (name.startsWith('.')) return { diagnostics: [] }
    if (!AGENT_NAME_PATTERN.test(name)) {
      return {
        diagnostics: [{
          path,
          code: 'invalid-agent-name',
          message: `"${name}" is not a kebab-case agent name (expected ${AGENT_NAME_PATTERN.source})`,
        }],
      }
    }
    if (name === RESERVED_AGENT_NAME && root.source !== 'bundled') {
      return {
        diagnostics: [{
          path,
          code: 'reserved-id',
          message: `"${RESERVED_AGENT_NAME}" is reserved for the built-in agent`,
          agentName: name,
        }],
      }
    }
    const documentPath = join(path, `${name}.agent.md`)
    const text = await fileSystem.readTextFile(documentPath)
    if (text === undefined) {
      return {
        diagnostics: [{
          path: documentPath,
          code: 'missing-document',
          message: `agent directory "${name}" has no ${name}.agent.md`,
          agentName: name,
        }],
      }
    }
    return buildDefinition(root, name, documentPath, text)
  }

  /** Turn one document into a definition plus its advisory diagnostics. */
  function buildDefinition(root: AgentRoot, agentName: string, documentPath: string, text: string): EntryResult {
    const document = parseAgentDocument(text)
    const { frontmatter } = document
    if (frontmatter.problems.length > 0) {
      return {
        diagnostics: [{
          path: documentPath,
          code: 'unparseable-frontmatter',
          message: frontmatter.problems.join('; '),
          agentName,
        }],
      }
    }
    const diagnostics: AgentDiagnostic[] = []
    if (Object.hasOwn(frontmatter.extra, 'id')) {
      diagnostics.push({
        path: documentPath,
        code: 'unexpected-id',
        message: 'frontmatter "id" is ignored: the directory name is the identity (ADR-0002)',
        agentName,
      })
    }
    const hasChain = (frontmatter.modelOrder?.length ?? 0) > 0 || (frontmatter.model?.length ?? 0) > 0
    if (!hasChain) {
      diagnostics.push({
        path: documentPath,
        code: 'no-model-order',
        message: 'neither modelOrder nor model is declared, so no model can resolve for this agent',
        agentName,
      })
    }
    const definition: AgentDefinition = {
      agentName,
      name: frontmatter.name ?? agentName,
      description: frontmatter.description ?? '',
      body: document.body,
      ...(frontmatter.modelOrder !== undefined ? { modelOrder: frontmatter.modelOrder } : {}),
      ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
      ...(frontmatter.requiredTools !== undefined ? { requiredTools: frontmatter.requiredTools } : {}),
      ...(frontmatter.skills !== undefined ? { skills: frontmatter.skills } : {}),
      ...(frontmatter.spawn !== undefined ? { spawn: frontmatter.spawn } : {}),
      ...(frontmatter.reasoningEffort !== undefined ? { reasoningEffort: frontmatter.reasoningEffort } : {}),
      ...(frontmatter.color !== undefined ? { color: frontmatter.color } : {}),
      ...(frontmatter.emoji !== undefined ? { emoji: frontmatter.emoji } : {}),
      source: root.source,
      origin: root.origin,
      extra: frontmatter.extra,
      path: documentPath,
    }
    return { definition, diagnostics }
  }

  /**
   * The memoised scan for one query.
   *
   * The scan itself is started without the caller's signal on purpose: the
   * cached result must not depend on which caller happened to arrive first, and
   * a caller-owned abort must not poison the shared in-flight scan. Each caller
   * still observes its own abort before and after awaiting.
   *
   * A failed scan (a trusted root that does not parse) is not cached, so the
   * next query retries instead of replaying one rejection forever; callers
   * still see the error every time until the asset is fixed.
   */
  async function scanFor(cwd: string | undefined, signal: AbortSignal | undefined): Promise<AgentScan> {
    signal?.throwIfAborted()
    // Resolved once per query: the memo key and the root table must describe the same project.
    const projectRoot = cwd === undefined ? undefined : await findProjectRoot(resolve(cwd), fileSystemFor(false))
    const key = projectRoot ?? NO_PROJECT_ROOT_KEY
    let pending = cache.get(key)
    if (pending === undefined) {
      pending = scan(projectRoot)
      pending.catch(() => {
        if (cache.get(key) === pending) cache.delete(key)
      })
      cache.set(key, pending)
    }
    const result = await pending
    signal?.throwIfAborted()
    return result
  }

  return {
    async list(options) {
      return (await scanFor(options?.cwd, options?.signal)).container.list()
    },
    async get(agentName, options) {
      return (await scanFor(options?.cwd, options?.signal)).container.get(agentName)
    },
    async diagnostics(options) {
      return (await scanFor(options?.cwd, undefined)).diagnostics
    },
    invalidate() {
      cache.clear()
    },
  }
}

/**
 * Walk up from `cwd` to the nearest directory holding a `.git` marker, falling
 * back to `cwd` itself — the native `findProjectRoot`
 * (`skill/skill-filesystem/src/index.ts:952`) semantics.
 */
export async function findProjectRoot(cwd: string, fileSystem: AgentFileSystem): Promise<string> {
  let current = cwd
  while (true) {
    if (await fileSystem.pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

/** Default DeepSeek Harness home (`~/.dsh`), mirroring the native helper. */
export function defaultDshHome(): string {
  return join(homedir(), '.dsh')
}

/** Default shared agents home (`~/.agents`), mirroring the native helper. */
export function defaultAgentsHome(): string {
  return join(homedir(), '.agents')
}

/** Resolve the harness home from an explicit path, `$DSH_HOME`, or `~/.dsh`. */
export function resolveDshHome(
  configured: string | undefined = undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveRoot(configured, env, DSH_HOME_ENV, defaultDshHome)
}

/** Resolve the shared agents home from an explicit path, `$DSH_AGENTS_HOME`, or `~/.agents`. */
export function resolveAgentsHome(
  configured: string | undefined = undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveRoot(configured, env, AGENTS_HOME_ENV, defaultAgentsHome)
}

/** Explicit path wins, then a non-blank environment override, then the default. */
function resolveRoot(
  configured: string | undefined,
  env: Record<string, string | undefined>,
  envName: string,
  fallback: () => string,
): string {
  const fromEnv = env[envName]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : fallback())
  return resolve(expandHomePath(selected))
}

/** Expand the supported `~` prefixes against the OS home. */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}
