/**
 * All-in-one compatibility entry: the two plugin rows of ticket 18
 * (`src/dsh/host/core.ts` + `src/dsh/host/providers.ts`) mounted together.
 * Existing single-row consumers keep working unchanged; the subpath exports
 * `./core` and `./providers/fs` mount the rows separately, which is what the
 * bundle patch does (`cordis.patch.yml`).
 */
import type { Context } from '@deepseek-ai/cordis'

import { applyCore } from './core.ts'
import { applyProviders } from './providers.ts'

export function apply(ctx: Context): void {
  // A provide inside one `apply()` is not visible to `ctx.get()` in the same
  // tick, so the provider half receives the registry instance directly.
  const { providers } = applyCore(ctx)
  applyProviders(ctx, providers)
}
