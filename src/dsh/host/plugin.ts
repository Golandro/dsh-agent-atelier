/**
 * The package's root entry, used in three ways:
 *
 * - all-in-one compatibility entry: the two plugin rows of ticket 18
 *   (`src/dsh/host/core.ts` + `src/dsh/host/providers.ts`) mounted together;
 *   existing single-row consumers keep working unchanged;
 * - a bare-name loader row with `config.role: 'ui-host'`: ticket 12's exact
 *   routes. The row must resolve to the bare package name so the client
 *   module scanner treats this package as a client source and loads
 *   `lib/client.js`; a subpath row is never scanned
 *   (`packages/client/modules/src/index.ts:893-896`);
 * - the subpath exports `./core` and `./providers/fs` mount the rows
 *   separately, which is what the bundle patch does (`cordis.patch.yml`).
 */
import type { Context } from '@deepseek-ai/cordis'

import { applyCore } from './core.ts'
import { applyProviders } from './providers.ts'
import { applyUiHost } from './ui-host.ts'

/** Loader-row config understood by the package root. */
export interface AgentManagerPluginConfig {
  /**
   * `all` (default) mounts the core + filesystem provider rows in one plugin;
   * `ui-host` mounts only the control routes, for the bare-name loader row.
   */
  readonly role?: 'all' | 'ui-host' | undefined
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
  applyProviders(ctx, providers)
}
