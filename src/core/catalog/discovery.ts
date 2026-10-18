/**
 * Agent discovery: the provider-driven search, the directory layout, and the
 * lazy read model behind `ctx.agentRegistry` (ticket 01 D19–D24; provider
 * wiring per ticket 18).
 *
 * The registry stays the deep module: providers are source adapters that only
 * list raw entries and read raw documents — classification, frontmatter
 * parsing, rank/trust merging and diagnostics happen here, so the frozen read
 * surface cannot fork across heterogeneous providers. The structure still
 * mirrors the native skill filesystem provider
 * (`skill/skill-filesystem/src/index.ts:244-263` for the root table), and the
 * locator is ours: native skills look for `SKILL.md`, agents look for
 * `<agent-name>/<agent-name>.agent.md`. One query resolves the project root
 * once and hands it to every provider.
 */
import { resolve } from 'node:path'

import type { AgentFileSystem } from '../ports.ts'
import { parseAgentDocument } from './frontmatter.ts'
import { createLazyLoad } from './lazy-load.ts'
import { createAgentRegistry, type AgentDefinitionContainer } from './registry.ts'
import { findProjectRoot } from './roots.ts'

import type {
  AgentDefinition,
  AgentDiagnostic,
  AgentDiagnosticCode,
  AgentProviders,
  AgentRegistry,
  AgentSourceProvider,
  ProviderLookupOptions,
  SourceDocument,
  SourceEntry,
} from '../../contract/index.ts'

/** Agent directories are lower-case kebab, exactly like native skill names. */
export const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** `default` names the built-in agent; a user directory with it is rejected. */
export const RESERVED_AGENT_NAME = 'default'

/** Diagnostic codes that flag a still-usable agent instead of hiding it. */
const ADVISORY_CODES: ReadonlySet<AgentDiagnosticCode> = new Set<AgentDiagnosticCode>(['unexpected-id', 'no-model-order'])

/** A flat document where a directory is expected. */
const MISPLACED_DOC_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.agent)?\.md$/

/** Host-side access injected into the service. */
export interface AgentRegistryDependencies {
  /**
   * The provider registry; its members drive every scan (ticket 18). Register,
   * unregister and `control.invalidate()` clear the memoised scans.
   */
  readonly providers: AgentProviders
  /**
   * Resolves the host `fs` service port when the project-root walk needs it;
   * `undefined` reads through Node. Called at use time, never at plugin load,
   * so an `fs` service mounted after this one is still honoured on the next
   * scan — the native `optionalFileSystem(ctx)` read
   * (`skill/skill-filesystem/src/index.ts:849`). Providers pick their own
   * filesystem ports; this one is only for the root walk.
   */
  readonly resolveFileSystem?: (() => AgentFileSystem | undefined) | undefined
  /** Node filesystem for the project-root walk and as the walk's fallback. */
  readonly nodeFileSystem: AgentFileSystem
  /** Diagnostic sink; `undefined` discards the log line. */
  readonly warn?: ((message: string) => void) | undefined
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
 * The first query for a project root scans the registered providers and
 * memoises the result; there is no watcher, so `invalidate()` is the only
 * rescan trigger besides provider changes. Concurrent queries share the
 * in-flight scan.
 */
export function createAgentRegistryService(dependencies: AgentRegistryDependencies): AgentRegistry {
  const providers = dependencies.providers
  const resolveHostFileSystem = dependencies.resolveFileSystem
  const warn = dependencies.warn ?? (() => {})

  /** Filesystem for the project-root walk: host `fs` when mounted, else Node. */
  function walkFileSystem(): AgentFileSystem {
    return resolveHostFileSystem?.() ?? dependencies.nodeFileSystem
  }

  /** Walk the providers in rank order; the first provider to claim a name wins. */
  async function scan(projectRoot: string | undefined): Promise<AgentScan> {
    const container = createAgentRegistry()
    const diagnostics: AgentDiagnostic[] = []
    const claimed = new Set<string>()
    const lookup: ProviderLookupOptions = { projectRoot }
    for (const provider of providers.listAgentProviders()) {
      const entries = await provider.listEntries(lookup)
      if (entries === undefined) continue
      const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of sorted) {
        const found = await discoverEntry(provider, entry, lookup)
        for (const diagnostic of found.diagnostics) {
          if (provider.trust === 'trusted' && !ADVISORY_CODES.has(diagnostic.code)) throw new AgentDocumentError(diagnostic)
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

  /** Read one listed entry: an agent, a misplaced document, or nothing at all. */
  async function discoverEntry(provider: AgentSourceProvider, entry: SourceEntry, lookup: ProviderLookupOptions): Promise<EntryResult> {
    if (entry.kind === 'directory') return await discoverDirectory(provider, entry, lookup)
    if (entry.kind !== 'file') return { diagnostics: [] }
    const misplaced = MISPLACED_DOC_PATTERN.exec(entry.name)
    if (misplaced === null) return { diagnostics: [] }
    const agentName = misplaced[1] ?? entry.name
    return {
      diagnostics: [{
        path: entry.path,
        code: 'misplaced-file',
        message: `flat documents are not agents; move it to ${agentName}/${agentName}.agent.md`,
        agentName,
        providerId: provider.id,
      }],
    }
  }

  /** Read `<name>/<name>.agent.md` through the provider, or explain why it is not an agent. */
  async function discoverDirectory(provider: AgentSourceProvider, entry: SourceEntry, lookup: ProviderLookupOptions): Promise<EntryResult> {
    const name = entry.name
    // Dotted entries (`.git`, `.system`, …) are host bookkeeping, not candidates.
    if (name.startsWith('.')) return { diagnostics: [] }
    if (!AGENT_NAME_PATTERN.test(name)) {
      return {
        diagnostics: [{
          path: entry.path,
          code: 'invalid-agent-name',
          message: `"${name}" is not a kebab-case agent name (expected ${AGENT_NAME_PATTERN.source})`,
          providerId: provider.id,
        }],
      }
    }
    if (name === RESERVED_AGENT_NAME && provider.source !== 'bundled') {
      return {
        diagnostics: [{
          path: entry.path,
          code: 'reserved-id',
          message: `"${RESERVED_AGENT_NAME}" is reserved for the built-in agent`,
          agentName: name,
          providerId: provider.id,
        }],
      }
    }
    const read = await provider.readDocument(entry, lookup)
    if (read.kind === 'missing') {
      return {
        diagnostics: [{
          path: read.path,
          code: 'missing-document',
          message: `agent directory "${name}" has no ${name}.agent.md`,
          agentName: name,
          providerId: provider.id,
        }],
      }
    }
    return buildDefinition(provider, name, read.document)
  }

  /** Turn one raw document into a definition plus its advisory diagnostics. */
  function buildDefinition(provider: AgentSourceProvider, agentName: string, document: SourceDocument): EntryResult {
    const parsed = parseAgentDocument(document.text)
    const { frontmatter } = parsed
    if (frontmatter.problems.length > 0) {
      return {
        diagnostics: [{
          path: document.path,
          code: 'unparseable-frontmatter',
          message: frontmatter.problems.join('; '),
          agentName,
          providerId: provider.id,
        }],
      }
    }
    const diagnostics: AgentDiagnostic[] = []
    if (Object.hasOwn(frontmatter.extra, 'id')) {
      diagnostics.push({
        path: document.path,
        code: 'unexpected-id',
        message: 'frontmatter "id" is ignored: the directory name is the identity (ADR-0002)',
        agentName,
        providerId: provider.id,
      })
    }
    const hasChain = (frontmatter.modelOrder?.length ?? 0) > 0 || (frontmatter.model?.length ?? 0) > 0
    if (!hasChain) {
      diagnostics.push({
        path: document.path,
        code: 'no-model-order',
        message: 'neither modelOrder nor model is declared, so no model can resolve for this agent',
        agentName,
        providerId: provider.id,
      })
    }
    const definition: AgentDefinition = {
      agentName,
      name: frontmatter.name ?? agentName,
      description: frontmatter.description ?? '',
      body: parsed.body,
      ...(frontmatter.modelOrder !== undefined ? { modelOrder: frontmatter.modelOrder } : {}),
      ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
      ...(frontmatter.requiredTools !== undefined ? { requiredTools: frontmatter.requiredTools } : {}),
      ...(frontmatter.skills !== undefined ? { skills: frontmatter.skills } : {}),
      ...(frontmatter.spawn !== undefined ? { spawn: frontmatter.spawn } : {}),
      ...(frontmatter.reasoningEffort !== undefined ? { reasoningEffort: frontmatter.reasoningEffort } : {}),
      ...(frontmatter.color !== undefined ? { color: frontmatter.color } : {}),
      ...(frontmatter.emoji !== undefined ? { emoji: frontmatter.emoji } : {}),
      source: provider.source,
      origin: provider.origin,
      providerId: provider.id,
      extra: frontmatter.extra,
      path: document.path,
    }
    return { definition, diagnostics }
  }

  /**
   * The memoised scan for one query (see `./lazy-load.ts` for the shared shape:
   * one scan per project root, no watcher, `invalidate()` as the only trigger).
   */
  const lazy = createLazyLoad<AgentScan>({
    resolveProjectRoot: (cwd) => findProjectRoot(resolve(cwd), walkFileSystem()),
    load: scan,
  })

  // Any provider change — register, unregister, control.invalidate() — drops
  // the memoised scans; the next query rescans.
  providers.onChange(() => lazy.invalidate())

  return {
    async list(options) {
      return (await lazy.forQuery(options?.cwd, options?.signal)).container.list()
    },
    async get(agentName, options) {
      return (await lazy.forQuery(options?.cwd, options?.signal)).container.get(agentName)
    },
    async diagnostics(options) {
      return (await lazy.forQuery(options?.cwd, undefined)).diagnostics
    },
    invalidate() {
      lazy.invalidate()
    },
  }
}
