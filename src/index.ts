import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'

import { createAgentRegistryService } from './discovery.ts'
import { optionalFileSystem } from './file-system.ts'
import { createAgentRegistry } from './registry.ts'
import type { AgentDefinition, AgentRegistry } from './types.ts'

/**
 * Service key of the agent-definition registry.
 *
 * Deliberately NOT `agents`: the host already registers the live Agent registry
 * under that key (`ctx.agents`), and a bundle must not shadow a native service.
 */
export const AGENT_REGISTRY_SERVICE = 'agentRegistry'

/**
 * The bundled agents shipped with this bundle (rank 600, trusted):
 * `<bundle root>/bundled`, resolved from this module's own location so the
 * source tree and the built `lib/` both point at the same directory.
 */
export const BUNDLED_AGENTS_DIR = fileURLToPath(new URL('../bundled', import.meta.url))

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
  const registry = createAgentRegistryService(
    {
      resolveFileSystem: () => optionalFileSystem(ctx),
      warn: (message) => ctx.logger.warn(message),
    },
    { bundledDir: BUNDLED_AGENTS_DIR },
  )
  ctx.effect(() => ctx.provide(AGENT_REGISTRY_SERVICE, registry))
}

export { createAgentRegistry, createAgentRegistryService, optionalFileSystem }
export type { AgentDefinition, AgentRegistry }
