import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'

import { AGENT_REGISTRY_SERVICE, ALIAS_REGISTRY_SERVICE } from '../../contract/index.ts'
import { createAgentRegistryService, createAliasRegistryService } from '../../core/index.ts'
import { createNodeFileSystem } from '../../providers/fs/index.ts'
import { optionalFileSystem } from './fs.ts'

import type { AgentModelTarget } from '../../contract/index.ts'

/**
 * The bundled agents shipped with this bundle (rank 600, trusted):
 * `<bundle root>/bundled`, resolved from this module's own location so the
 * source tree and the built `lib/` both point at the same directory.
 */
export const BUNDLED_AGENTS_DIR = fileURLToPath(new URL('../../../bundled', import.meta.url))

/**
 * Host plugin entry. Registers the lazy agent registry on the calling context
 * and hands its disposal to Cordis, so unloading the plugin removes the service
 * again. Nothing is scanned here: the first query does that (D24).
 *
 * The host `fs` service is resolved per scan, not captured here: the native
 * loader reads `optionalFileSystem(ctx)` at use time
 * (`skill/skill-filesystem/src/index.ts:849`), so a service mounted after this
 * plugin is still honoured instead of being silently replaced by Node reads.
 */
export function apply(ctx: Context): void {
  const nodeFileSystem = createNodeFileSystem()
  const registry = createAgentRegistryService(
    {
      nodeFileSystem,
      resolveFileSystem: () => optionalFileSystem(ctx),
      warn: (message) => ctx.logger.warn(message),
    },
    { bundledDir: BUNDLED_AGENTS_DIR },
  )
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
}

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
