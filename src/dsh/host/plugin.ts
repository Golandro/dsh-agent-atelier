/**
 * The package's root entry, used in three ways:
 *
 * - all-in-one compatibility entry: the bundle's host rows (`core` + `assembly`
 *   + `providers`, ticket 18/04) mounted together; existing single-row
 *   consumers keep working unchanged;
 * - a bare-name loader row with `config.role: 'ui-host'`: ticket 12's exact
 *   routes. The row must resolve to the bare package name so the client
 *   module scanner treats this package as a client source and loads
 *   `lib/client.js`; a subpath row is never scanned
 *   (`packages/client/modules/src/index.ts:893-896`);
 * - the subpath exports `./core`, `./assembly`, and `./providers/fs` mount the
 *   rows separately, which is what the bundle patch does
 *   (`cordis.patch.yml`).
 */
import type { Context } from '@deepseek-ai/cordis'

import { applyAssembly } from './assembly.ts'
import { applyCore } from './core.ts'
import { applyProviders } from './providers.ts'
import { applySummon } from './summon.ts'
import { applyUiHost } from './ui-host.ts'

/**
 * Loader-row config understood by the package root.
 *
 * Only `ui-host` is a real mode: the bare-name row asks for it so the row does
 * not mount the registries a second time. Everything else — an absent config,
 * an empty one, or any other value — mounts the all-in-one compatibility
 * entry, which is what `package.json`'s `main` and the subpath rows need.
 *
 * 簇 M: the old `'all'` literal was never passed by anything and meant exactly
 * the same as omitting the field, so it is gone; `ui-host` is the one value
 * that selects a different behaviour.
 */
export interface AgentManagerPluginConfig {
  /** `ui-host` mounts only the control routes, for the bare-name loader row. */
  readonly role?: 'ui-host' | undefined
}

/** Plugin entry; the loader passes the row config as the second argument. */
export function apply(ctx: Context, config: AgentManagerPluginConfig = {}): void {
  if (config.role === 'ui-host') {
    applyUiHost(ctx)
    return
  }
  // A provide inside one `apply()` is not visible to `ctx.get()` in the same
  // tick, so the provider half receives the registry instance directly.
  const { providers } = applyCore(ctx)
  applyAssembly(ctx)
  applySummon(ctx)
  applyProviders(ctx, providers)
}
