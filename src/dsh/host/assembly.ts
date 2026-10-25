/**
 * The compat assembly plugin row (ticket 04): the only provider of
 * `agentAssembly`.
 *
 * It is deliberately a separate bundle row, not part of the core row, so the
 * replacement mode can disable just this row in `cordis.patch.yml` and insert
 * its own package without touching the registries or the control face. The row
 * provides a plain object service; ticket 07 calls it with an Agent's own
 * scoped context, and ticket 06 reads its lints.
 */
import type { Context } from '@deepseek-ai/cordis'

import { AGENT_ASSEMBLY_SERVICE } from '../../contract/index.ts'
import { createAssemblyService } from '../../agent-assembly/index.ts'

import type { AssemblyConfig } from '../../contract/index.ts'

/** Loader-row config of the assembly row; overridable from the profile patch. */
export interface AssemblyPluginConfig {
  /** Section-order overrides; absent means the recommended cache layering. */
  readonly assembly?: AssemblyConfig | undefined
}

/**
 * Mount the assembly service on this context.
 *
 * Each successful mount also becomes a plugin effect, so unloading the row
 * disposes the Agent's scoped sections through the host's own disposers; the
 * registration object's `dispose()` stays the idempotent reload point.
 */
export function applyAssembly(ctx: Context, config: AssemblyPluginConfig = {}): void {
  const assembly = createAssemblyService({
    config: config.assembly,
    onMount: (dispose) => {
      ctx.effect(() => dispose)
    },
  })
  ctx.effect(() => ctx.provide(AGENT_ASSEMBLY_SERVICE, assembly))
}

/** Plugin entry: the loader mounts this module through its named `apply`. */
export const apply = applyAssembly
