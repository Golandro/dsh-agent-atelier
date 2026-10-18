/**
 * The file-system provider plugin row (ticket 18): registers the four default
 * file roots plus the bundled root as `AgentSourceProvider`s on the
 * `agentProviders` service. Roots are resolved by this layer — project roots
 * derive from the `projectRoot` the registry passes per query, user roots read
 * `$DSH_HOME` / `$DSH_AGENTS_HOME` per query, the bundled root is fixed — and
 * never by the providers themselves.
 *
 * This row `inject`s `agentProviders`, so it stays pending until the core row
 * has provided the service; the all-in-one compatibility entry
 * (`src/dsh/host/plugin.ts`) passes the instance it built directly, because a
 * provide inside one `apply()` is not visible to `ctx.get()` in the same tick.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'

import { AGENT_PROVIDERS_SERVICE, SERVICE_API_VERSION } from '../../contract/index.ts'
import { resolveAgentsHome, resolveDshHome } from '../../core/index.ts'
import { createFileSystemAgentProvider, createNodeFileSystem } from '../../providers/fs/index.ts'
import { optionalFileSystem } from './fs.ts'

import type { AgentProviders } from '../../contract/index.ts'

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

/**
 * The bundled agents shipped with this bundle (rank 600, trusted):
 * `<bundle root>/bundled`, resolved from this module's own location so the
 * source tree and the built `lib/` both point at the same directory.
 */
export const BUNDLED_AGENTS_DIR = fileURLToPath(new URL('../../../bundled', import.meta.url))

/** The service this row requires before it can apply. */
export const inject = [AGENT_PROVIDERS_SERVICE]

/**
 * Register the default agent source providers. When the instance is not handed
 * over (the provider-row path), it is read from the context — which `inject`
 * guarantees to exist by apply time.
 */
export function applyProviders(ctx: Context, providers?: AgentProviders): void {
  const service = providers ?? (ctx.get(AGENT_PROVIDERS_SERVICE) as AgentProviders | undefined)
  if (service === undefined) {
    throw new Error(`applyProviders requires the "${AGENT_PROVIDERS_SERVICE}" service (declare inject: ["${AGENT_PROVIDERS_SERVICE}"])`)
  }
  // §2.2 convention: validate the version, treat a mismatch as a missing
  // capability instead of guessing the shape.
  if (service.apiVersion !== SERVICE_API_VERSION) {
    throw new Error(`applyProviders: "${AGENT_PROVIDERS_SERVICE}" has apiVersion ${String(service.apiVersion)}, expected ${SERVICE_API_VERSION}`)
  }
  const nodeFileSystem = createNodeFileSystem()
  // Project and user roots read the host `fs` service at use time and fall
  // back to Node; the trusted bundled root bypasses the host service entirely,
  // like the native `trustedHost` path.
  const selectQueryableFileSystem = () => optionalFileSystem(ctx) ?? nodeFileSystem

  ctx.effect(() => {
    const disposers = [
      service.registerAgentProvider(() =>
        createFileSystemAgentProvider({
          id: 'project-dsh',
          source: 'project-dsh',
          rank: PROJECT_DSH_RANK,
          trust: 'untrusted',
          origin: 'user',
          resolveRoot: (projectRoot) => (projectRoot === undefined ? undefined : join(projectRoot, '.dsh', 'agents')),
          selectFileSystem: selectQueryableFileSystem,
        }),
      ),
      service.registerAgentProvider(() =>
        createFileSystemAgentProvider({
          id: 'project-agents',
          source: 'project-agents',
          rank: PROJECT_AGENTS_RANK,
          trust: 'untrusted',
          origin: 'user',
          resolveRoot: (projectRoot) => (projectRoot === undefined ? undefined : join(projectRoot, '.agents', 'agents')),
          selectFileSystem: selectQueryableFileSystem,
        }),
      ),
      service.registerAgentProvider(() =>
        createFileSystemAgentProvider({
          id: 'user-dsh',
          source: 'user-dsh',
          rank: USER_DSH_RANK,
          trust: 'untrusted',
          origin: 'user',
          resolveRoot: () => join(resolveDshHome(), 'agents'),
          selectFileSystem: selectQueryableFileSystem,
        }),
      ),
      service.registerAgentProvider(() =>
        createFileSystemAgentProvider({
          id: 'user-agents',
          source: 'user-agents',
          rank: USER_AGENTS_RANK,
          trust: 'untrusted',
          origin: 'user',
          resolveRoot: () => join(resolveAgentsHome(), 'agents'),
          selectFileSystem: selectQueryableFileSystem,
        }),
      ),
      service.registerAgentProvider(() =>
        createFileSystemAgentProvider({
          id: 'bundled',
          source: 'bundled',
          rank: BUNDLED_AGENT_RANK,
          trust: 'trusted',
          origin: 'built-in',
          resolveRoot: () => BUNDLED_AGENTS_DIR,
          selectFileSystem: () => nodeFileSystem,
        }),
      ),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/** Plugin entry alias: the loader mounts this module through its named `apply`. */
export const apply = applyProviders
