/**
 * The core plugin row (ticket 18): the provider registry plus the two read
 * models and ticket 11's control core. It provides `agentProviders` — a plain
 * object, deliberately not in the `Service` catalog so provider rows can
 * `inject` it — the `agentRegistry` / `aliasRegistry` read models, and the
 * `agentControl` write/compose face that ticket 12's ui-host row consumes. No
 * default provider registers here; that is the provider row's job
 * (`src/dsh/host/providers.ts`).
 */
import type { Context } from '@deepseek-ai/cordis'

import { AGENT_CONTROL_SERVICE, AGENT_PROVIDERS_SERVICE, AGENT_REGISTRY_SERVICE, ALIAS_REGISTRY_SERVICE } from '../../contract/index.ts'
import { createAgentProviders, createAgentRegistryService, createAliasRegistryService, resolveDshHome } from '../../core/index.ts'
import { createControlCore } from '../../control/index.ts'
import { createNodeControlFileSystem, createNodeFileSystem } from '../../providers/fs/index.ts'
import { optionalFileSystem } from './fs.ts'

import type { AgentModelTarget, AgentProviders, ModelRoute, ModelSelectionPolicy } from '../../contract/index.ts'
import type { ControlCore } from '../../control/index.ts'

/**
 * Wire the core services onto the context and return the provider registry so
 * the all-in-one shell can hand it to the provider half directly — a provide
 * inside one `apply()` is not visible to `ctx.get()` until the callback
 * returns, so the shell cannot re-read the service it just provided.
 */
export function applyCore(ctx: Context): { readonly providers: AgentProviders } {
  const nodeFileSystem = createNodeFileSystem()

  const providers = createAgentProviders()
  ctx.effect(() => ctx.provide(AGENT_PROVIDERS_SERVICE, providers))

  // The project-root walk resolves the host `fs` service per scan, not captured
  // here: the native loader reads `optionalFileSystem(ctx)` at use time
  // (`skill/skill-filesystem/src/index.ts:849`), so a service mounted after
  // this plugin is still honoured instead of being silently replaced by Node
  // reads. Providers pick their own filesystem ports.
  const registry = createAgentRegistryService({
    providers,
    nodeFileSystem,
    resolveFileSystem: () => optionalFileSystem(ctx),
    warn: (message) => ctx.logger.warn(message),
  })
  ctx.effect(() => ctx.provide(AGENT_REGISTRY_SERVICE, registry))

  // The alias registry reads the DSH default pair through the injected closure,
  // so `ctx.agentDefaultModel` is resolved per load rather than captured here.
  const aliasRegistry = createAliasRegistryService({
    nodeFileSystem,
    resolveFileSystem: () => optionalFileSystem(ctx),
    readDefaultPair: () => optionalDefaultPair(ctx),
    warn: (message) => ctx.logger.warn(message),
  })
  ctx.effect(() => ctx.provide(ALIAS_REGISTRY_SERVICE, aliasRegistry))

  // Ticket 11's control core is the only compose/write face in the bundle.
  // Ticket 12's ui-host row injects this service instead of re-deriving block
  // routing, layer resolution or conflict handling in the route.
  const control: ControlCore = createControlCore({
    agentRegistry: registry,
    aliasRegistry,
    fileSystem: createNodeControlFileSystem(),
    resolveProjectRoot: () => process.cwd(),
    resolveDshHome: () => resolveDshHome(),
    warn: (message) => ctx.logger.warn(message),
    // Ticket 19: the host setting's allowlist, read per call — the user can
    // change it while the plugin is mounted, so capturing it here would keep
    // a stale list. No service, or one that has never been given routes,
    // means no allowlist (every route allowed).
    resolveSelectionPolicy: () => optionalSelectionPolicy(ctx),
  })
  ctx.effect(() => ctx.provide(AGENT_CONTROL_SERVICE, control))

  return { providers }
}

/** Plugin entry: the loader mounts this module through its named `apply`. */
export const apply = applyCore

/** The slice of the host `agentDefaultModel` service this bundle reads. */
interface HostDefaultModel {
  currentSelection(): { readonly provider: string; readonly model: string }
}

/** The slice of the host `subagentModelSelection` settings service this bundle reads. */
interface HostModelSelection {
  current(): { readonly enabled?: boolean; readonly allowedModels?: readonly ModelRoute[] | undefined }
}

/**
 * The host setting's route allowlist as a {@link ModelSelectionPolicy}.
 *
 * Only an **enabled**, explicitly configured, non-empty route list becomes a
 * policy: the native service gates the allowlist on `enabled` (and refuses
 * `enabled` with an empty list), so a disabled setting's retained routes must
 * not become a stale allowlist. The native default (`allowedModels: []`) is
 * "the preference is off", which must not read as "an empty allowlist refuses
 * everything" — that would break every agent the moment the service exists.
 * Read at use time, structurally, for the same reason as
 * {@link optionalDefaultPair} (the native package is not importable from this
 * bundle, ADR-0001).
 */
export function optionalSelectionPolicy(ctx: Context): ModelSelectionPolicy | undefined {
  const candidate: unknown = ctx.get('subagentModelSelection')
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const service = candidate as Partial<HostModelSelection>
  if (typeof service.current !== 'function') return undefined
  const current = service.current()
  // The native service gates the allowlist on `enabled`; a disabled setting
  // keeps its routes but must not enforce them (and an enabled empty list is
  // refused upstream), so only an explicitly enabled setting is a policy.
  if (current.enabled !== true) return undefined
  const routes = current.allowedModels
  if (!Array.isArray(routes)) return undefined
  const allowed: ModelRoute[] = []
  for (const route of routes) {
    if (typeof route !== 'object' || route === null) continue
    const { provider, model } = route
    if (typeof provider !== 'string' || typeof model !== 'string') continue
    if (provider === '' || model === '') continue
    allowed.push({ provider, model })
  }
  return allowed.length === 0 ? undefined : { routes: allowed }
}

/**
 * The DSH sub-agent default pair, as the built-in `dsh-default` alias sees it.
 *
 * The native package cannot be imported from this bundle (ADR-0001), so the
 * service is read structurally — and at use time, never in `apply()`, so a
 * service mounted after this plugin is still honoured (the lesson from ticket
 * 01's fix round). No service, or an empty selection, means no built-in alias
 * rather than an invented one.
 */
function optionalDefaultPair(ctx: Context): AgentModelTarget | undefined {
  const candidate: unknown = ctx.get('agentDefaultModel')
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const service = candidate as Partial<HostDefaultModel>
  if (typeof service.currentSelection !== 'function') return undefined
  const selection = service.currentSelection()
  if (selection.provider === '' || selection.model === '') return undefined
  return { provider: selection.provider, model: selection.model }
}
