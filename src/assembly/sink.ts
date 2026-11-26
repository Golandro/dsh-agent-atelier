/**
 * The compat-mode registration sink (ticket 04): the base service face other
 * tickets code against, provided under `agentAssembly`.
 *
 * It owns the one runtime surface the bundle registers into: an Agent's scoped
 * prompt registry. Planning stays in {@link planAssembly}; this file only
 * mounts the plan's executable system rows, replaces a previous mount whole,
 * and turns every host disposer into one idempotent `dispose()`.
 *
 * The replacement package implements the same key with a wide subtype; nothing
 * here grows a mode flag or a capability probe.
 */
import { createPromptLedger } from './ledger.ts'
import { planAssembly } from './planner.ts'

import type {
  AgentAssembly,
  AssemblyConfig,
  AssemblyPlan,
  AssemblyRegistration,
  AssemblyScope,
  AssemblySection,
  AssemblySession,
  PromptSection,
} from '../contract/index.ts'
import type { PromptLedger } from './ledger.ts'
import type { PromptSectionLedgerEntry } from './segments.ts'

/** Construction options of the compat sink. */
export interface AssemblyServiceOptions {
  /** Global section-order overrides from the assembly row's config. */
  readonly config?: AssemblyConfig | undefined
  /**
   * Register one mount's disposal on the owning plugin context. The host row
   * passes `ctx.effect`, so an HMR unload ends in the host's section disposers;
   * ticket 07's ledger re-mounts after the service comes back.
   */
  readonly onMount?: ((dispose: () => Promise<void>) => void) | undefined
  /**
   * The registration-side ledger this sink writes into (ticket 84).
   *
   * The row owns it so the ledger outlives a single service instance (an HMR
   * reload replaces the service, and the preview reads the same table). Absent
   * means the sink keeps a private one, which is enough for tests but invisible
   * to a consumer.
   */
  readonly ledger?: PromptLedger | undefined
}

/**
 * Create the compat assembly service.
 *
 * Mounts are per scope: a second mount for the same scope disposes the first
 * and registers the new plan whole, and concurrent mounts are serialised so a
 * slower earlier call cannot overwrite a later one. Registration is
 * scope-visible and scope-lifetime; this service creates no Agent, starts no
 * session and writes nothing.
 */
export function createAssemblyService(options: AssemblyServiceOptions = {}): AgentAssembly {
  const mounts = new WeakMap<AssemblyScope, AssemblyRegistration>()
  const queues = new WeakMap<AssemblyScope, Promise<void>>()
  const ledger = options.ledger ?? createPromptLedger()

  return {
    plan(session) {
      return planAssembly(session, options.config)
    },

    async registerAssemblySections(input) {
      // The tail is always a resolved promise: failures go to their own caller
      // and never poison the queue for a later mount.
      const prior = queues.get(input.scope) ?? Promise.resolve()
      const run = prior.then(() => mount(input.scope, input.session))
      queues.set(input.scope, run.then(() => undefined, () => undefined))
      return await run
    },
  }

  /** Replace one scope's mount with the input's plan. */
  async function mount(scope: AssemblyScope, session: AssemblySession): Promise<AssemblyRegistration> {
    const previous = mounts.get(scope)
    if (previous !== undefined) await previous.dispose()

    const plan = planAssembly(session, options.config)
    const disposers: Array<() => void> = []
    const registered: RegisteredRow[] = []
    try {
      for (const section of plan.sections) {
        if (!section.executable) continue
        const host = hostSectionOf(section)
        disposers.push(scope.systemPrompt.section(host))
        registered.push({ row: section, host })
      }
    } catch (error) {
      // A failed mount leaves no half-mounted scope: undo what this call added
      // and reject. The previous mount is already gone, as full replacement says.
      for (const dispose of disposers) dispose()
      throw error
    }

    const registration = createRegistration(session.agent.agentName, plan, disposers, () => {
      ledger.forget(scope)
    })
    try {
      options.onMount?.(() => registration.dispose())
    } catch (error) {
      await registration.dispose()
      throw error
    }
    // Publish only after the plugin hook accepted the mount: a failing hook
    // must not leave the scope pointing at an already-disposed registration.
    mounts.set(scope, registration)
    // The ledger records exactly what reached the host registry — the plan's
    // non-executable rows never did, so recording them would make the preview
    // invent a segment for something that was never registered.
    //
    // 票 82 复审曾提议把 `executable: false` 的规划行也记成「已知未注册」，以便
    // `missing-from-assembly` 有真实来源。**没有采纳**：账本的语义是「注册方记下
    // 自己注册了什么」，把没注册的记进去会污染这个语义，而且每个锚点行都会让那条
    // 诊断常亮——从信号变成噪声。本版没有这些行，UI 里已如实说明（见
    // `PREVIEW_PARTS_UNAVAILABLE` 与 ⑤ 组 registrant 文案）。
    ledger.record(scope, registeredEntries(registered, session))
    return registration
  }
}

/** One registration over the host disposers its mount received. */
function createRegistration(
  agentName: string,
  plan: AssemblyPlan,
  disposers: readonly (() => void)[],
  onDispose: () => void,
): AssemblyRegistration {
  let disposed = false
  return {
    agentName,
    plan,
    async dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of disposers) dispose()
      onDispose()
    },
  }
}

/** One plan row together with the section it actually registered. */
interface RegisteredRow {
  readonly row: AssemblySection
  readonly host: PromptSection
}

/**
 * One registered row as the ledger records it.
 *
 * The registrant is this bundle's sink, so every row here is source
 * `atelier-section` — including the persona row, which reuses the host's
 * `deployment:persona-prefix` name only so that the scoped registration shadows
 * the deployment-wide one. Attribution follows the registrant, not the name
 * (spec §2 / GLOSSARY「来源」).
 *
 * `planName` is recorded only when the registered name differs from the plan
 * row's name. Today `hostSectionOf` passes the row name through unchanged, so
 * the two always agree and no entry carries it; the comparison is written out
 * anyway, so a future rename cannot silently change the second-level key the
 * preview groups by.
 */
function registeredEntries(
  rows: readonly RegisteredRow[],
  session: AssemblySession,
): readonly PromptSectionLedgerEntry[] {
  // 注册时刻能确知的两件事：这份配置来自哪个文档（layer），以及本仓写下去的原文
  // （registeredText）。后者让读面能算出 waterfall 有没有改写（产物文本 vs 原文）。
  const layer = session.agent.path
  const registered: PromptSectionLedgerEntry[] = rows.map(({ row, host }) => ({
    sectionName: host.name,
    source: 'atelier-section',
    ...row.name === host.name ? {} : { planName: row.name },
    ...typeof layer === 'string' && layer !== '' ? { layer } : {},
    ...typeof host.text === 'string' ? { registeredText: host.text } : {},
  }))
  return registered
}

/**
 * One plan row as the host registry takes it.
 *
 * The plan's `order` and `interpolate` are authoritative: the planner already
 * carries the host placement and the substitution consequence, so an override
 * and the registration cannot disagree. The persona row keeps the native
 * section name (that is what shadows the deployment-wide prefix) and its
 * verbatim text (native interpolation still applies).
 */
function hostSectionOf(section: AssemblySection): PromptSection {
  return {
    name: section.name,
    order: section.order,
    text: section.text,
    ...section.interpolate === undefined ? {} : { interpolate: section.interpolate },
  }
}
