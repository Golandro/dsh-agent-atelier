/**
 * Where the registries look: the project-root walk and the home directories.
 *
 * Both ticket 01's agent discovery and ticket 02's registry.yaml layers need
 * these two facts, so they live here once instead of being copied into each
 * scan: {@link findProjectRoot} walks up to the nearest `.git` marker, and the
 * home resolvers answer "which harness home is in play" with explicit path >
 * environment override > default precedence.
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { AgentFileSystem } from '../ports.ts'

/** Environment variable overriding the DeepSeek Harness home (native `DSH_HOME_ENV`). */
export const DSH_HOME_ENV = 'DSH_HOME'
/** Environment variable overriding the shared agents home (native `AGENTS_HOME_ENV`). */
export const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

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
