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
import { planAssembly, MODEL_SYSTEM_SECTION } from './planner.ts'

import type {
  AgentAssembly,
  AssemblyConfig,
  AssemblyPlan,
  AssemblyRegistration,
  AssemblyScope,
  AssemblySection,
  AssemblySectionRegistration,
  AssemblySession,
} from '../contract/index.ts'

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
    try {
      for (const section of plan.sections) {
        if (!section.executable) continue
        disposers.push(scope.systemPrompt.section(hostSectionOf(section)))
      }
    } catch (error) {
      // A failed mount leaves no half-mounted scope: undo what this call added
      // and reject. The previous mount is already gone, as full replacement says.
      for (const dispose of disposers) dispose()
      throw error
    }

    const registration = createRegistration(session.agent.agentName, plan, disposers)
    try {
      options.onMount?.(() => registration.dispose())
    } catch (error) {
      await registration.dispose()
      throw error
    }
    // Publish only after the plugin hook accepted the mount: a failing hook
    // must not leave the scope pointing at an already-disposed registration.
    mounts.set(scope, registration)
    return registration
  }
}

/** One registration over the host disposers its mount received. */
function createRegistration(
  agentName: string,
  plan: AssemblyPlan,
  disposers: readonly (() => void)[],
): AssemblyRegistration {
  let disposed = false
  return {
    agentName,
    plan,
    async dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of disposers) dispose()
    },
  }
}

/**
 * One plan row as the host registry takes it.
 *
 * The plan's `order` is authoritative: it already carries the host placement —
 * the recommended one, or the `sectionOrder` renumbering — so an override and
 * the registration cannot disagree. The persona row keeps the native section
 * name (that is what shadows the deployment-wide prefix) and its verbatim text
 * (native interpolation still applies); the model row was substituted by the
 * planner and is registered with `interpolate: false`.
 */
function hostSectionOf(section: AssemblySection): AssemblySectionRegistration {
  return {
    name: section.name,
    order: section.order,
    text: section.text,
    ...section.name === MODEL_SYSTEM_SECTION ? { interpolate: false } : {},
  }
}
