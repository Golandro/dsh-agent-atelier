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

import type { AgentFileSystem, FileSystemDependencies } from '../ports.ts'
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
  ModelDeclaration,
  ModelDefinition,
} from '../../contract/index.ts'

/** File name of a registry layer inside an agents directory (spec §5.2). */
export const REGISTRY_FILE_NAME = 'registry.yaml'

/** Host-side access injected into the service. */
export interface AliasRegistryDependencies extends FileSystemDependencies {
  /**
   * Reads the DSH sub-agent default pair. Called once per load, so the built-in
   * alias is a load-time snapshot that only `invalidate()` refreshes (triage
   * Q1), and `undefined` — no host service, or no selection — means this host
   * has no built-in alias rather than a silently invented one.
   */
  readonly readDefaultPair?: (() => AgentModelTarget | undefined) | undefined
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
export interface AliasLayer {
  readonly path: string
  readonly source: AliasRegistrySource
}

/**
 * The registry layer table for one project root, highest precedence first: the
 * workspace's `<project>/.dsh/agents/registry.yaml`, then the global
 * `$DSH_HOME/agents/registry.yaml`.
 *
 * Exported for the write side (ticket 11): an `addAlias`/`addModel` edit lands
 * in the file its source names, and the control core derives that path from
 * here so the precedence rule lives in exactly one place.
 */
export function aliasRegistryLayers(projectRoot: string | undefined, dshHome: string): readonly AliasLayer[] {
  const layers: AliasLayer[] = []
  if (projectRoot !== undefined) {
    layers.push({ path: join(projectRoot, '.dsh', 'agents', REGISTRY_FILE_NAME), source: 'project-dsh' })
  }
  layers.push({ path: join(dshHome, 'agents', REGISTRY_FILE_NAME), source: 'user-dsh' })
  return layers
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
    return aliasRegistryLayers(projectRoot, resolveDshHome(options.dshHome, env))
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
    return { snapshot: foldModelGroups(withBuiltInAlias({ models, aliases }, readDefaultPair?.())), diagnostics }
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
 * Model-level availability key of one entry: its `modelGroup`, or its own name
 * when the entry declares none (R1 §2.2/§6.2). This is also the ledger's
 * model-level aggregation key, so the loader and the engine's own aggregation
 * use one reading of the field.
 */
export function modelGroupOf(entry: ModelDeclaration): string {
  return entry.modelGroup ?? entry.modelName
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
  // The whole entry is indexed, not just its name: a pool is judged by the
  // routes it collects, and a route is the entry's provider+model line (R1 D-8).
  const entriesByName = new Map(snapshot.models.map((entry) => [entry.modelName, entry]))
  const modelNames = new Set(entriesByName.keys())

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

  // Fan-in is judged per route, not per entry name (R1 D-8): two entries of one
  // model behind two different providers are two lines, so a pool that spends
  // both of them on one model is redundancy, while two aliases naming the same
  // line really do share a capability.
  //
  // An alias counts once per route — twice the same line in two entries of one
  // pool is not shared intent — and the built-in pointer is ignored entirely:
  // it mirrors the default pair, so it would flag every user alias that happens
  // to name the same route.
  const byRoute = new Map<string, { readonly names: string[]; readonly labels: string[] }>()
  for (const entry of snapshot.aliases) {
    if (entry.source === 'built-in') continue
    const routes = new Map<string, readonly string[]>()
    for (const target of entry.targets) {
      const model = entriesByName.get(target)
      if (model === undefined) continue
      const key = routeKeyOf(model)
      const names = routes.get(key)
      if (names === undefined) routes.set(key, [target])
      else if (!names.includes(target)) routes.set(key, [...names, target])
    }
    for (const [key, targets] of routes) {
      const slot = byRoute.get(key) ?? { names: [], labels: [] }
      byRoute.set(key, {
        names: [...slot.names, entry.alias],
        labels: [...slot.labels, targets.map((target) => `"${target}"`).join(' / ')],
      })
    }
  }
  for (const [route, { names, labels }] of byRoute) {
    if (names.length < 2) continue
    findings.push({
      severity: 'hint',
      code: 'alias-fan-in',
      alias: names.join(', '),
      message: `aliases ${names.map((name) => `"${name}"`).join(', ')} all point at route "${route}" (via ${labels.join('; ')})`,
    })
  }

  findings.push(...inspectPools(snapshot.aliases, entriesByName))

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

/** The ledger's route key: one `provider`+`model` line (R2 §6.2). */
function routeKeyOf(entry: ModelDefinition): string {
  return `${entry.provider}/${entry.model}`
}

/** The declared targets of one pool that the registry actually has. */
function poolEntries(
  entry: AliasDefinition,
  entriesByName: ReadonlyMap<string, ModelDefinition>,
): readonly ModelDefinition[] {
  const models: ModelDefinition[] = []
  for (const target of entry.targets) {
    const model = entriesByName.get(target)
    if (model !== undefined) models.push(model)
  }
  return models
}

/**
 * Judge each user alias as the pool it is (R1 §2.1, §7.4). Both findings are
 * hints, never errors: the syntax is legal and resolution walks the pool as
 * written, but the pool is expressing something the schema has a better place
 * for, so the user gets told rather than blocked.
 *
 * The built-in pointer is skipped by construction — it is a pool of one that
 * mirrors the host's default pair, so there is never a pool to judge.
 */
function inspectPools(
  aliases: readonly AliasDefinition[],
  entriesByName: ReadonlyMap<string, ModelDefinition>,
): readonly AliasFinding[] {
  const findings: AliasFinding[] = []
  for (const entry of aliases) {
    if (entry.source === 'built-in') continue
    const models = poolEntries(entry, entriesByName)
    if (models.length < 2) continue

    const labels = (entries: readonly ModelDefinition[]): string => entries.map((model) => `"${model.modelName}"`).join(', ')
    const [head, ...rest] = models
    /* v8 ignore next -- length was checked above. */
    if (head === undefined) continue

    // Cross-model pool: a capability gradient (R1 §2.1). It is not redundancy —
    // it silently changes the capability tier, the sysPrompt and the effort
    // support as soon as a line is skipped, and the agent's modelOrder says
    // "try the strong one, then the cheap one" without hiding it in a pool.
    const otherModels = rest.filter((model) => model.model !== head.model)
    if (otherModels.length > 0) {
      findings.push({
        severity: 'hint',
        code: 'pool-mixed-models',
        alias: entry.alias,
        message: `alias "${entry.alias}" pools several models (${labels([head, ...otherModels])}); a capability gradient belongs in the agent's modelOrder, not in one pool`,
      })
    }

    // Mixed groups: the redundancy is split across model-level switches, so
    // switching the model off no longer covers every line of the pool.
    const headGroup = modelGroupOf(head)
    const otherGroups = rest.filter((model) => modelGroupOf(model) !== headGroup)
    if (otherGroups.length > 0) {
      findings.push({
        severity: 'hint',
        code: 'pool-mixed-groups',
        alias: entry.alias,
        message: `alias "${entry.alias}" pools entries of different modelGroups ("${headGroup}" and ${otherGroups.map((model) => `"${modelGroupOf(model)}"`).join(', ')}); the model-level switch covers one group per pool`,
      })
    }
  }
  return findings
}

/**
 * Fold the model-level switch into the line switch every consumer already
 * reads (R1 §2.2): one entry of a group declaring `available: false` makes the
 * whole group read `false`.
 *
 * Resolution therefore stays an entry-by-entry judge with no second code path,
 * and "switch the whole model off" is one flag in one group rather than the
 * same `available: false` copied onto every line. Applied after the merge and
 * the built-in pointer, so the fold sees the effective set: a workspace layer
 * overriding a name changes both the group membership and the outcome.
 *
 * The fold never drops a group entry from the list: an entry overridden into
 * another group is still read as written, and resetting it to false would
 * silently widen the user's switch.
 */
function foldModelGroups(snapshot: AliasRegistrySnapshot): AliasRegistrySnapshot {
  if (snapshot.models.length <= 1) return snapshot
  const unavailable = new Set<string>()
  for (const entry of snapshot.models) {
    if (!entry.available) unavailable.add(modelGroupOf(entry))
  }
  if (unavailable.size === 0) return snapshot
  let changed = false
  const models = snapshot.models.map((entry) => {
    if (entry.available && unavailable.has(modelGroupOf(entry))) {
      changed = true
      return { ...entry, available: false }
    }
    return entry
  })
  return changed ? { ...snapshot, models } : snapshot
}
