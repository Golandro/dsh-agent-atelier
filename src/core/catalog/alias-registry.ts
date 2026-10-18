/**
 * The alias registry: registry.yaml layers, the workspace-wins merge, the
 * built-in `dsh-default` pointer and the pure cross-layer inspection
 * (ticket `.scratch/agents-manager/issues/02-alias-registry.md`, spec §5.2).
 *
 * Two layers are read, in this order: the workspace's
 * `<project>/.dsh/agents/registry.yaml` and the global
 * `$DSH_HOME/agents/registry.yaml`, workspace winning on a shared name — the
 * same precedence rule, and the same rank-order listing, as the discovery roots
 * in `./discovery.ts`. The parts both registries share live in one place rather
 * than being copied: the project-root walk and home resolution in `./roots.ts`,
 * the lazy per-project-root memoisation in `./lazy-load.ts`.
 *
 * A layer is read whole or dropped whole with diagnostics (triage Q4), the
 * built-in alias follows the DSH default pair as a load-time snapshot (Q1) and
 * always points at a model entry, synthesising one when nothing matches (Q2),
 * and every problem this module reports is *data*: findings from
 * {@link inspectAliasRegistry}, or diagnostics from a dropped layer. Nothing
 * here throws at runtime.
 */
import { join, resolve } from 'node:path'

import type { AgentFileSystem } from '../ports.ts'
import { createLazyLoad } from './lazy-load.ts'
import { DEFAULT_ALIAS_NAME, readRegistryLayer } from './registry-file.ts'
import { findProjectRoot, resolveDshHome } from './roots.ts'

import type {
  AgentChainInput,
  AgentModelTarget,
  AliasDefinition,
  AliasDiagnostic,
  AliasFinding,
  AliasRegistry,
  AliasRegistrySnapshot,
  AliasRegistrySource,
  ModelDefinition,
} from '../../contract/index.ts'

/** File name of a registry layer inside an agents directory (spec §5.2). */
export const REGISTRY_FILE_NAME = 'registry.yaml'

/** Host-side access injected into the service. */
export interface AliasRegistryDependencies {
  /**
   * Resolves the host `fs` port when a load needs it; `undefined` reads through
   * Node. Called at use time, never at plugin load, so an `fs` service mounted
   * after this one is still honoured on the next load — the native
   * `optionalFileSystem(ctx)` read (`skill/skill-filesystem/src/index.ts:849`).
   */
  readonly resolveFileSystem?: (() => AgentFileSystem | undefined) | undefined
  /**
   * Node filesystem used as the fallback when no host `fs` port resolves;
   * every registry layer is user content, so none of them bypasses the host.
   */
  readonly nodeFileSystem: AgentFileSystem
  /**
   * Reads the DSH sub-agent default pair. Called once per load, so the built-in
   * alias is a load-time snapshot that only `invalidate()` refreshes (triage
   * Q1), and `undefined` — no host service, or no selection — means this host
   * has no built-in alias rather than a silently invented one.
   */
  readonly readDefaultPair?: (() => AgentModelTarget | undefined) | undefined
  /** Diagnostic sink; `undefined` discards the log line. */
  readonly warn?: ((message: string) => void) | undefined
}

/** Home override; injectable so tests never touch the real `~/.dsh`. */
export interface AliasRegistryOptions {
  /** The harness home holding the global layer; defaults to `$DSH_HOME` or `~/.dsh`. */
  readonly dshHome?: string | undefined
  /** Environment mapping for the home override; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined> | undefined
}

/** One memoised load: both read surfaces come from the same pass. */
interface AliasLoad {
  readonly snapshot: AliasRegistrySnapshot
  readonly diagnostics: readonly AliasDiagnostic[]
}

/** One layer file, in precedence order. */
interface AliasLayer {
  readonly path: string
  readonly source: AliasRegistrySource
}

/**
 * Create the lazy alias registry.
 *
 * The first query for a project root loads the layers and memoises the result;
 * there is no watcher, so `invalidate()` is the only reload trigger. Concurrent
 * queries share the in-flight load.
 */
export function createAliasRegistryService(
  dependencies: AliasRegistryDependencies,
  options: AliasRegistryOptions = {},
): AliasRegistry {
  const nodeFileSystem = dependencies.nodeFileSystem
  const resolveHostFileSystem = dependencies.resolveFileSystem
  const readDefaultPair = dependencies.readDefaultPair
  const warn = dependencies.warn ?? (() => {})
  const env = options.env ?? process.env

  /** Every layer is user content, so all of them may go through the host `fs` service. */
  function fileSystem(): AgentFileSystem {
    return resolveHostFileSystem?.() ?? nodeFileSystem
  }

  /** The layer table for one query, highest precedence first. */
  function buildLayers(projectRoot: string | undefined): readonly AliasLayer[] {
    const layers: AliasLayer[] = []
    if (projectRoot !== undefined) {
      layers.push({ path: join(projectRoot, '.dsh', 'agents', REGISTRY_FILE_NAME), source: 'project-dsh' })
    }
    layers.push({ path: join(resolveDshHome(options.dshHome, env), 'agents', REGISTRY_FILE_NAME), source: 'user-dsh' })
    return layers
  }

  /** Read every layer and merge them: first layer to claim a name wins. */
  async function load(projectRoot: string | undefined): Promise<AliasLoad> {
    const port = fileSystem()
    const diagnostics: AliasDiagnostic[] = []
    const models: ModelDefinition[] = []
    const aliases: AliasDefinition[] = []
    const claimedModels = new Set<string>()
    const claimedAliases = new Set<string>()
    for (const layer of buildLayers(projectRoot)) {
      // A missing layer file is a layer with nothing to merge, not a problem.
      const text = await port.readTextFile(layer.path)
      if (text === undefined) continue
      const read = readRegistryLayer(text)
      if (!read.ok) {
        for (const failure of read.failures) {
          const diagnostic: AliasDiagnostic = { path: layer.path, code: failure.code, message: failure.message }
          diagnostics.push(diagnostic)
          warn(`alias registry: ${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`)
        }
        continue
      }
      for (const entry of read.data.models) {
        if (claimedModels.has(entry.modelName)) continue
        claimedModels.add(entry.modelName)
        models.push({ ...entry, source: layer.source, path: layer.path })
      }
      for (const entry of read.data.aliases) {
        if (claimedAliases.has(entry.alias)) continue
        claimedAliases.add(entry.alias)
        aliases.push({ ...entry, source: layer.source, path: layer.path })
      }
    }
    return { snapshot: withBuiltInAlias({ models, aliases }, readDefaultPair?.()), diagnostics }
  }

  /**
   * The memoised load for one query (see `./lazy-load.ts` for the shared shape:
   * one load per project root, no watcher, `invalidate()` as the only trigger —
   * which is also what re-reads the default pair, triage Q1).
   */
  const lazy = createLazyLoad<AliasLoad>({
    resolveProjectRoot: (cwd) => findProjectRoot(resolve(cwd), fileSystem()),
    load,
  })

  return {
    async snapshot(options) {
      return (await lazy.forQuery(options?.cwd, options?.signal)).snapshot
    },
    async getAlias(aliasName, options) {
      return (await lazy.forQuery(options?.cwd, options?.signal)).snapshot.aliases.find((entry) => entry.alias === aliasName)
    },
    async getModel(modelName, options) {
      return (await lazy.forQuery(options?.cwd, options?.signal)).snapshot.models.find((entry) => entry.modelName === modelName)
    },
    async diagnostics(options) {
      return (await lazy.forQuery(options?.cwd, undefined)).diagnostics
    },
    invalidate() {
      lazy.invalidate()
    },
  }
}

/**
 * Add the built-in pointer, and the implicit entry it points at when the
 * default pair matches nothing declared (triage Q2).
 *
 * Keeping the pointer aimed at a model entry — real or synthesised — is what
 * lets every consumer treat `dsh-default` like any other alias, with no special
 * case, which is the invariant D6 asks for.
 */
function withBuiltInAlias(
  declared: { readonly models: readonly ModelDefinition[]; readonly aliases: readonly AliasDefinition[] },
  pair: AgentModelTarget | undefined,
): AliasRegistrySnapshot {
  if (pair === undefined) return { models: declared.models, aliases: declared.aliases }
  const builtInAlias = (target: string): AliasDefinition => ({ alias: DEFAULT_ALIAS_NAME, targets: [target], source: 'built-in' })
  // The merged list is already in precedence order (workspace layer first), so
  // the first match is the highest-precedence declaration (triage Q2).
  const match = declared.models.find((entry) => entry.provider === pair.provider && entry.model === pair.model)
  if (match !== undefined) return { models: declared.models, aliases: [...declared.aliases, builtInAlias(match.modelName)] }
  const implicit: ModelDefinition = {
    modelName: DEFAULT_ALIAS_NAME,
    provider: pair.provider,
    model: pair.model,
    available: true,
    source: 'built-in',
    synthesized: true,
  }
  return { models: [...declared.models, implicit], aliases: [...declared.aliases, builtInAlias(DEFAULT_ALIAS_NAME)] }
}

/**
 * Inspect a merged registry, and optionally a set of agent chains, for problems
 * the user can fix. Pure: same inputs, same findings; no filesystem, no host
 * context (triage Q5).
 *
 * The agent side is injected as plain data on purpose — ticket 02 must not scan
 * agent roots or consume `ctx.agentRegistry`. A chain that runs out is not
 * reported here either: that is ticket 03's hard error (D8), and this layer
 * only hands the user something to fix before it gets that far.
 */
export function inspectAliasRegistry(
  snapshot: AliasRegistrySnapshot,
  agents: readonly AgentChainInput[] = [],
): readonly AliasFinding[] {
  const findings: AliasFinding[] = []
  const aliasNames = new Set(snapshot.aliases.map((entry) => entry.alias))
  const modelNames = new Set(snapshot.models.map((entry) => entry.modelName))

  for (const entry of snapshot.aliases) {
    for (const target of entry.targets) {
      if (modelNames.has(target)) continue
      findings.push({
        severity: 'error',
        code: 'unknown-model-target',
        alias: entry.alias,
        message: `alias "${entry.alias}" points at model "${target}", which the registry does not have`,
      })
    }
  }

  // Fan-in ignores the built-in pointer: it mirrors the default pair, so it
  // would otherwise flag every user alias that happens to name the same model.
  const byTarget = new Map<string, string[]>()
  for (const entry of snapshot.aliases) {
    if (entry.source === 'built-in') continue
    for (const target of entry.targets) byTarget.set(target, [...(byTarget.get(target) ?? []), entry.alias])
  }
  for (const [target, names] of byTarget) {
    if (names.length < 2) continue
    findings.push({
      severity: 'hint',
      code: 'alias-fan-in',
      alias: names.join(', '),
      message: `aliases ${names.map((name) => `"${name}"`).join(', ')} all point at model "${target}"`,
    })
  }

  for (const agent of agents) {
    for (const name of agent.modelOrder ?? []) {
      if (aliasNames.has(name)) continue
      findings.push({
        severity: 'error',
        code: 'unknown-alias',
        agentName: agent.agentName,
        alias: name,
        // The built-in name is owned here and cannot be declared by a user, so a
        // missing one is a host-composition fact, not something to go write.
        message: name === DEFAULT_ALIAS_NAME
          ? `agent "${agent.agentName}" modelOrder names the built-in alias "${name}", which exists only when the host exposes a readable agentDefaultModel default pair`
          : `agent "${agent.agentName}" modelOrder names alias "${name}", which the registry does not have`,
      })
    }
    if ((agent.model?.length ?? 0) > 0) {
      findings.push({
        severity: 'hint',
        code: 'raw-model-escape',
        agentName: agent.agentName,
        message: `agent "${agent.agentName}" uses the raw model chain; prefer an alias so the tuning layer stays swappable`,
      })
    }
  }

  return findings
}
