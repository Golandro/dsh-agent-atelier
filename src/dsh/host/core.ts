/**
 * The core plugin row (ticket 18): the provider registry plus the two read
 * models. It provides `agentProviders` — a plain object, deliberately not in
 * the `Service` catalog so provider rows can `inject` it — and the
 * `agentRegistry` / `aliasRegistry` services that consume it. No default
 * provider registers here; that is the provider row's job
 * (`src/dsh/host/providers.ts`).
 */
import type { Context } from '@deepseek-ai/cordis'

import { AGENT_PROVIDERS_SERVICE, AGENT_REGISTRY_SERVICE, ALIAS_REGISTRY_SERVICE } from '../../contract/index.ts'
import { createAgentProviders, createAgentRegistryService, createAliasRegistryService } from '../../core/index.ts'
import { createNodeFileSystem } from '../../providers/fs/index.ts'
import { optionalFileSystem } from './fs.ts'

import type { AgentModelTarget, AgentProviders } from '../../contract/index.ts'

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

  return { providers }
}

/** Plugin entry: the loader mounts this module through its named `apply`. */
export const apply = applyCore

/** The slice of the host `agentDefaultModel` service this bundle reads. */
interface HostDefaultModel {
  currentSelection(): { readonly provider: string; readonly model: string }
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
