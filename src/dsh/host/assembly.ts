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
import { createAssemblyService, createPromptLedger } from '../../assembly/index.ts'

import type { AssemblyConfig } from '../../contract/index.ts'

/**
 * 宿主内部服务键：注册侧账本（票 84 的 {@link PromptLedger}）。
 *
 * 刻意不进 `src/contract/service-keys.ts`——契约层不需要知道「注册侧账本」这个
 * 实现细节，它只是本 bundle 两行之间的交接：装配行往里写，读面（票 83）从里读。
 * 两边必须拿**同一个实例**，否则读面只会读到一张空表。
 */
export const PROMPT_LEDGER_SERVICE = 'agentPromptLedger'

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
  // One ledger per row, handed to the sink so the read face can ask "what did
  // this bundle actually register for this scope" without re-deriving it.
  const ledger = createPromptLedger()
  const assembly = createAssemblyService({
    config: config.assembly,
    ledger,
    onMount: (dispose) => {
      ctx.effect(() => dispose)
    },
  })
  ctx.effect(() => ctx.provide(AGENT_ASSEMBLY_SERVICE, assembly))
  ctx.effect(() => ctx.provide(PROMPT_LEDGER_SERVICE, ledger))
}

/** Plugin entry: the loader mounts this module through its named `apply`. */
export const apply = applyAssembly
