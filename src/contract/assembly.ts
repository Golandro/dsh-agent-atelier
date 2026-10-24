/**
 * Cross-package contract of prompt assembly (ticket 04): the planner's data
 * shapes, the runtime registration sink, and the base service face downstream
 * tickets (06 warnings, 07 summon) code against.
 *
 * The compat package implements {@link AgentAssembly} by registering scoped
 * sections into the host prompt registry; the replacement package is a wide
 * subtype activated by `cordis.patch.yml` and never changes these members.
 * Shapes here are plain data: no host types, no I/O, no persistence.
 */
import type { AgentDefinition, ModelDefinition, ModelRoute } from './types.ts'

/**
 * Placement route of one assembly section.
 *
 * A plan lists rows in the recommended cache layering (D10): the per-model
 * system prompt, the tools field, the persona, preset skills, the digest, the
 * first message, then pre-step. Only `system` rows are registered by the
 * compat sink; every other channel is a modeled anchor executed by tickets
 * 06/07 or by DSH itself.
 */
export type AssemblyChannel = 'system' | 'tools' | 'digest' | 'first-message' | 'pre-step'

/**
 * A dimension a section depends on. Frequency, rarest first: `model` (fallback
 * only), `registry`, `tools`, `agent` (every summon). Breakpoints are computed
 * per dimension; the order lint compares system rows against this frequency.
 */
export type AssemblyVariesWith = 'model' | 'agent' | 'registry' | 'tools'

/** One row of an assembly plan. */
export interface AssemblySection {
  readonly channel: AssemblyChannel
  /**
   * Stable name. `system` rows register under exactly this name; the persona
   * row is the native `deployment:persona-prefix`, so a scoped registration
   * shadows the deployment-wide one instead of duplicating it.
   */
  readonly name: string
  /**
   * Host placement for `system` rows (ascending; ties by code-unit name order,
   * exactly the host registry). Rows on other channels carry `0`: their
   * cache-layering position comes from the plan array, not this field.
   */
  readonly order: number
  /** Every dimension this row depends on; empty for a natural tail. */
  readonly variesWith: readonly AssemblyVariesWith[]
  /**
   * Text as registered. The model-system row already substituted `{{provider}}`
   * and `{{model}}` from the resolved route (registered with
   * `interpolate: false`); the persona row stays verbatim so the host's own
   * variable interpolation still applies. Channel anchors carry `''`.
   */
  readonly text: string
  /**
   * `true` only for system rows this bundle registers. `false` marks a modeled
   * anchor whose channel is executed elsewhere.
   */
  readonly executable: boolean
  /**
   * Effective lint exemption from the order override. It waives only the
   * volatile-before-stable lint; it never changes placement, text, or runtime
   * cache behavior.
   */
  readonly cacheIsolated: boolean
}

/** The first plan row a dimension depends on. */
export interface AssemblyBreakpoint {
  readonly dimension: AssemblyVariesWith
  readonly channel: AssemblyChannel
  /** Name of the first row depending on the dimension. */
  readonly section: string
}

/** Stable lint codes. */
export type AssemblyLintCode =
  /** A more frequently varying system row sits before a more stable one. */
  | 'volatile-before-stable'

/** One advisory placement finding; never a throw and never a gate. */
export interface AssemblyLint {
  readonly code: AssemblyLintCode
  readonly severity: 'warning'
  readonly channel: AssemblyChannel
  /** The offending row: the earlier, more volatile one. */
  readonly section: string
  /** One line, safe for the advisor panel. */
  readonly message: string
}

/** The planner's complete output: a derived value with no persistence. */
export interface AssemblyPlan {
  /** Rows in the recommended cache-layering order (D10). */
  readonly sections: readonly AssemblySection[]
  /** One entry per dimension that has a dependent row, in stable dimension order. */
  readonly breakpoints: readonly AssemblyBreakpoint[]
  /** Placement advice; may be empty. */
  readonly lints: readonly AssemblyLint[]
}

/** A bare section name, or a name carrying its lint exemption. */
export type AssemblyOrderEntry =
  | string
  | { readonly name: string; readonly cacheIsolated?: boolean | undefined }

/**
 * Global placement overrides from the assembly row's config.
 *
 * Listed rows take the array order (system rows re-numbered from zero);
 * unlisted rows are appended in their recommended order. Unknown and duplicate
 * names are ignored. Absent means the recommended order.
 */
export interface AssemblyConfig {
  readonly sectionOrder?: readonly AssemblyOrderEntry[] | undefined
}

/**
 * The planner's minimal view of a resolved session. `ComposedAgentSession`
 * (control) satisfies it structurally; this contract never imports control.
 */
export interface AssemblySession {
  readonly agent: AgentDefinition
  readonly parameters: AssemblySessionParameters
  /** Winning registry entry; absent when a raw `model:` pair won. */
  readonly model?: ModelDefinition | undefined
}

/** The session fields assembly reads. */
export interface AssemblySessionParameters {
  readonly route: ModelRoute
  readonly persona: string
}

/**
 * The scoped host registry slice the sink uses. The host's `agent.ctx`
 * satisfies it structurally: every `section()` call registers in that agent's
 * scope and returns the host's disposal effect, so a same-name persona section
 * shadows the deployment-wide one instead of colliding with it.
 */
export interface AssemblyScope {
  readonly systemPrompt: AssemblySectionRegistrar
}

/** Structural slice of `ctx.systemPrompt`; not a re-implementation. */
export interface AssemblySectionRegistrar {
  /**
   * Register one section in the calling scope and return the host's disposer.
   * Same-name scoped sections shadow global ones; duplicates in one scope
   * throw.
   */
  section(section: AssemblySectionRegistration): () => void
  /** Native placement of the deployment persona prefix (order 0 today). */
  getSectionOrder(name: 'DEPLOYMENT_PERSONA_PREFIX'): number
}

/** One section as handed to the host registry; text is already final. */
export interface AssemblySectionRegistration {
  readonly name: string
  readonly order: number
  readonly text: string
  /**
   * `false` for the model-system row (the planner substituted its variables);
   * omitted for the persona row so native `{{variable}}` interpolation still
   * applies.
   */
  readonly interpolate?: boolean | undefined
}

/** One agent's mounted assembly; ticket 07 keeps this in its agent→plan ledger. */
export interface AssemblyRegistration {
  readonly agentName: string
  readonly plan: AssemblyPlan
  /**
   * Dispose every section this mount added. Idempotent. This is the server-side
   * reload point: cordis HMR disposal ends in these host disposers, and the
   * agent→plan ledger re-mounts afterwards.
   */
  dispose(): Promise<void>
}

/** Input of one full mount; a second mount for the same scope replaces the first. */
export interface AssemblyMountInput {
  /** The agent's scoped context; pass `agent.ctx` inside its setup window. */
  readonly scope: AssemblyScope
  readonly session: AssemblySession
}

/**
 * The base assembly face (compat mode), provided under `agentAssembly`.
 *
 * Ticket 06 (lints) and ticket 07 (summon) code against exactly this interface.
 * Replacement mode is a separate package activated by `cordis.patch.yml`; it
 * provides the same key with a wide subtype: every member here keeps its name,
 * parameters, and base return contract, while extra members or richer return
 * objects stay invisible to downstream code typed against this face. There is
 * no capability probe.
 */
export interface AgentAssembly {
  /** Plan one resolved session. Pure and deterministic; no I/O, no persistence. */
  plan(session: AssemblySession): AssemblyPlan
  /**
   * Mount, or fully replace, this agent's executable system rows.
   *
   * Full async reload: the previous mount for this scope is disposed first,
   * then every executable row is registered. A failure leaves the scope with
   * no half-mounted registration and rejects. No agent or session is created
   * here; the caller owns that lifecycle.
   */
  registerAssemblySections(input: AssemblyMountInput): Promise<AssemblyRegistration>
}
