/**
 * Frozen public contract of the agent registry (ticket
 * `.scratch/agents-manager/issues/01-agent-registry.md`, section
 * `## 契约（冻结）`).
 *
 * Member names follow the domain glossary (`CONTEXT.md`): the address key is
 * `agentName` (the `agent-name` directory, never the deprecated frontmatter
 * `id`) and the document text is `body` (正文, not "persona").
 *
 * Tickets 03/05/06 consume exactly this surface; the query options mirror the
 * native `SkillLookupOptions { cwd?, signal? }`
 * (`skill/skill/src/index.ts:103-108`) so a caller that knows the skill lookup
 * already knows this one.
 */

/** Discovery root an agent document was read from, lowest rank first. */
export type AgentSource = 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents' | 'bundled'

/** Whether the definition is ours (`bundled/`) or written by the user. */
export type AgentOrigin = 'built-in' | 'user'

/**
 * Why a candidate was skipped or flagged. Every code except `unexpected-id` and
 * `no-model-order` makes the agent invisible (soft diagnostics, D21); inside a
 * trusted root it is a hard error instead.
 */
export type AgentDiagnosticCode =
  | 'invalid-agent-name'
  | 'reserved-id'
  | 'missing-document'
  | 'misplaced-file'
  | 'unparseable-frontmatter'
  | 'unexpected-id'
  | 'no-model-order'

/** One finding from discovery. */
export interface AgentDiagnostic {
  /** Absolute path the finding is about (the document, or the missing document). */
  readonly path: string
  readonly code: AgentDiagnosticCode
  /** Human-readable, one line, safe to log and to show in the UI. */
  readonly message: string
  /** Agent name the finding belongs to, when the candidate had a usable name. */
  readonly agentName?: string | undefined
}

/** One legacy `model:` chain entry: a direct provider/model pair (D5 escape hatch). */
export interface AgentModelTarget {
  readonly provider: string
  readonly model: string
}

/** One discovered agent document, as the registry hands it to consumers. */
export interface AgentDefinition {
  /** Agent name: the `agent-name` directory. Reserved value `default` is the built-in agent. */
  readonly agentName: string
  /** Display name: frontmatter `name`, falling back to {@link agentName}. */
  readonly name: string
  /** One-line summary: frontmatter `description`, defaulting to `''`. */
  readonly description: string
  /** Document body (正文): everything after the frontmatter fence. */
  readonly body: string
  /** Alias chain, tried before {@link model}. */
  readonly modelOrder?: readonly string[] | undefined
  /** Legacy direct provider/model chain, used only after `modelOrder` is exhausted. */
  readonly model?: readonly AgentModelTarget[] | undefined
  /** Tool names the agent expects; only warnable, never enforced here (D9). */
  readonly requiredTools?: readonly string[] | undefined
  /** Preset skill names (D20); existence is ticket 06's warning. */
  readonly skills?: readonly string[] | undefined
  /** Default flavor written in the document; the call site may override it. */
  readonly spawn?: 'spawn' | 'fork' | undefined
  /** Agent-level reasoning effort default. */
  readonly reasoningEffort?: string | undefined
  /** Optional display color (Agency-compatible). */
  readonly color?: string | undefined
  /** Optional display emoji (Agency-compatible). */
  readonly emoji?: string | undefined
  /** Discovery root this definition won in. */
  readonly source: AgentSource
  /** `built-in` only for the bundled root. */
  readonly origin: AgentOrigin
  /** Unrecognised frontmatter keys, kept as raw text so an editor can write them back (D14). */
  readonly extra: Readonly<Record<string, string>>
  /** Absolute path of the document that produced this definition. */
  readonly path: string
}

/**
 * Query options, isomorphic to the native `SkillLookupOptions`
 * (`skill/skill/src/index.ts:103-108`).
 *
 * `cwd` selects which project root is scanned; without it the project-level
 * roots are not part of the search at all (native `roots()` behaviour).
 */
export interface AgentLookupOptions {
  readonly cwd?: string | undefined
  readonly signal?: AbortSignal | undefined
}

/** Options of {@link AgentRegistry.diagnostics}; a scan needs no signal. */
export interface AgentDiagnosticsOptions {
  readonly cwd?: string | undefined
}

/**
 * The read model registered as `ctx.agentRegistry` (D24).
 *
 * First query per project root scans the roots and memoises the result; there
 * is no watcher, so {@link invalidate} is the only way to force a rescan.
 */
export interface AgentRegistry {
  /** Every discovered agent, lowest rank first, then by name. */
  list(options?: AgentLookupOptions): Promise<readonly AgentDefinition[]>
  /** The agent named `agentName`, if any; the built-in `default` is always present. */
  get(agentName: string, options?: AgentLookupOptions): Promise<AgentDefinition | undefined>
  /** Findings from the scan that backs {@link list}, memoised alongside it. */
  diagnostics(options?: AgentDiagnosticsOptions): Promise<readonly AgentDiagnostic[]>
  /** Drop the memoised scans; the next query rescans. */
  invalidate(): void
}

/* ── Alias and model registry (ticket 02) ────────────────────────────────────
 *
 * Second half of the frozen contract: the alias layer an agent's `modelOrder`
 * resolves through (spec §5.2, D5/D6/D18). It is frozen here because tickets
 * 03/05/06 consume exactly this surface, the same reason ticket 01 froze its
 * own half above.
 */

/** Registry layer a model entry or alias was declared in, highest precedence first. */
export type AliasRegistrySource = 'project-dsh' | 'user-dsh' | 'built-in'

/**
 * One real model entry as a layer declares it (spec §5.2).
 *
 * Provider and model stay flat, exactly as the YAML and the legacy
 * `AgentModelTarget` escape hatch write them, so consumers never walk a nested
 * pair the spec does not have.
 */
export interface ModelDeclaration {
  /** Key under `models:`; what an alias points at. */
  readonly modelName: string
  readonly provider: string
  readonly model: string
  /** Per-model system prompt (D12 channel ①); absent means the entry adds none. */
  readonly sysPrompt?: string | undefined
  /** v1 manual availability switch; a false entry is skipped during resolution (D6). */
  readonly available: boolean
}

/** One real model entry, as the alias registry hands it to consumers. */
export interface ModelDefinition extends ModelDeclaration {
  readonly source: AliasRegistrySource
  /** True only for the implicit entry synthesised for an unmatched default pair (triage Q2). */
  readonly synthesized?: boolean | undefined
  /** Layer file this entry was declared in; absent for the built-in entry. */
  readonly path?: string | undefined
}

/** One alias pointer as a layer declares it (spec §5.2). */
export interface AliasDeclaration {
  readonly alias: string
  /** v1 holds exactly one model entry name; the pool form is R1/R2 work (D18). */
  readonly targets: readonly string[]
}

/** One alias pointer: the name an agent's `modelOrder` uses (D5/D18). */
export interface AliasDefinition extends AliasDeclaration {
  readonly source: AliasRegistrySource
  /** Layer file this alias was declared in; absent for the built-in pointer. */
  readonly path?: string | undefined
}

/**
 * Everything the two layers declare, merged, plus the built-in pointer.
 *
 * This is the pure data ticket 03's resolution engine consumes: no filesystem,
 * no host context, no laziness.
 */
export interface AliasRegistrySnapshot {
  readonly models: readonly ModelDefinition[]
  readonly aliases: readonly AliasDefinition[]
}

/**
 * Why a whole registry.yaml layer was dropped (soft diagnostics, D21-isomorphic;
 * triage Q4 — a broken layer never merges half of itself, and never throws).
 */
export type AliasDiagnosticCode = 'unparseable-registry' | 'invalid-registry'

/** One finding about a registry.yaml layer that was dropped. */
export interface AliasDiagnostic {
  /** Absolute path of the layer file. */
  readonly path: string
  readonly code: AliasDiagnosticCode
  /** Human-readable, one line, safe to log and to show in the UI. */
  readonly message: string
}

/** Query options, isomorphic to {@link AgentLookupOptions}. */
export interface AliasLookupOptions {
  readonly cwd?: string | undefined
  readonly signal?: AbortSignal | undefined
}

/** Options of {@link AliasRegistry.diagnostics}; a load needs no signal. */
export interface AliasDiagnosticsOptions {
  readonly cwd?: string | undefined
}

/**
 * The read model registered as `ctx.aliasRegistry` (ticket 02).
 *
 * First query per project root loads the layers and memoises the result; there
 * is no watcher, so {@link invalidate} is the only way to force a reload —
 * including re-reading the DSH default pair (triage Q1).
 */
export interface AliasRegistry {
  /** The merged registry: real model entries first, then the built-in alias. */
  snapshot(options?: AliasLookupOptions): Promise<AliasRegistrySnapshot>
  /** The alias named `aliasName`, if any; the built-in `dsh-default` is present when a pair is readable. */
  getAlias(aliasName: string, options?: AliasLookupOptions): Promise<AliasDefinition | undefined>
  /** The model entry named `modelName`, if any. */
  getModel(modelName: string, options?: AliasLookupOptions): Promise<ModelDefinition | undefined>
  /** Findings from the load that backs {@link snapshot}, memoised alongside it. */
  diagnostics(options?: AliasDiagnosticsOptions): Promise<readonly AliasDiagnostic[]>
  /** Drop the memoised loads; the next query reloads and re-reads the default pair. */
  invalidate(): void
}

/** Severity of one cross-layer finding: an error the user must fix, or a hint. */
export type AliasFindingSeverity = 'error' | 'hint'

/** What one cross-layer finding is about. */
export type AliasFindingCode =
  /** An agent's `modelOrder` names an alias the registry does not have. */
  | 'unknown-alias'
  /** An alias points at a model entry the registry does not have. */
  | 'unknown-model-target'
  /** An agent still uses the legacy `model:` chain instead of an alias (D5 escape hatch). */
  | 'raw-model-escape'
  /** Several aliases resolve to the same model entry (harmless, flagged as intent overlap). */
  | 'alias-fan-in'

/**
 * One finding from the pure cross-layer inspection.
 *
 * Findings are data, never throws (triage Q5): running out of chain is ticket
 * 03's hard error, and this layer only hands the user something to fix.
 */
export interface AliasFinding {
  readonly severity: AliasFindingSeverity
  readonly code: AliasFindingCode
  /** Human-readable, one line, safe to log and to show in the UI. */
  readonly message: string
  /** Agent the finding belongs to, for the agent-side codes. */
  readonly agentName?: string | undefined
  /** Alias the finding is about, where the code names one. */
  readonly alias?: string | undefined
}

/**
 * The agent-side input of {@link inspectAliasRegistry}: plain data, so the
 * inspection stays pure and ticket 02 never reads agent roots itself.
 */
export interface AgentChainInput {
  readonly agentName: string
  readonly modelOrder?: readonly string[] | undefined
  readonly model?: readonly AgentModelTarget[] | undefined
}
