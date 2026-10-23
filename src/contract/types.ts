/**
 * Frozen public contract of the agent registry (ticket
 * `.scratch/agents-manager/issues/01-agent-registry.md`, section
 * `## 契约（冻结）`).
 *
 * Member names follow the domain glossary (`GLOSSARY.md`): the address key is
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
  /** The source provider this finding came from (ticket 18). */
  readonly providerId: string
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
  /** The source provider this definition was read through (ticket 18). */
  readonly providerId: string
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
 * First query per project root scans the registered providers and memoises
 * the result; there is no watcher, so {@link invalidate} is the only way to
 * force a rescan (provider changes clear the cache too, ticket 18).
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

/* ── Model chain resolution (ticket 03, spec §5.3) ───────────────────────────
 *
 * Third half of the frozen contract: what the pure resolution engine answers.
 * It is frozen here because 05 (UI) and 06 (catalog warnings) render the
 * report itself, and 07 maps the failure onto a tool `isError`; only the
 * engine's internal signatures stay inside `core/` (docs/core-design.md §3.1).
 */

/**
 * Where one candidate entered the chain.
 *
 * Both sources converge on the engine's single internal candidate pipeline
 * (2026-10-20 residual K): an alias expands to its model entries, the legacy
 * `model:` array contributes `raw` entries, and from there on the steps —
 * availability, whitelist, effort — are one code path. This tag is the only
 * difference that survives, because it is *provenance*: consumers warn on
 * `raw` ("prefer an alias", D5) and never branch on it otherwise.
 */
export type ChainCandidateOrigin = 'alias' | 'raw'

/** Why one candidate did not win; absent on the chain's winner. */
export type ChainSkipReason =
  /** The alias a `modelOrder` entry names is not in the registry snapshot. */
  | 'unknown-alias'
  /** The alias points at a model entry the snapshot does not have. */
  | 'unknown-model'
  /** The model entry declares `available: false`, the v1 manual switch (D6). */
  | 'unavailable'
  /** The route is not in the selection policy's allowed routes (spec §5.3-2). */
  | 'not-allowed'

/** One exact child LLM route authorized to be chosen (DSH `AllowedModelRoute`). */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/**
 * What the resolution engine is allowed to choose, mirroring DSH
 * `ModelSelectionPolicy` (`model-selection.ts` in the `tool-subagent` package).
 *
 * `routes` omitted means this session has no allowlist and every route is
 * allowed; an empty array allows nothing. Unlike DSH's model-facing selection,
 * an agent document is *always* an explicit selection (frontmatter names the
 * route), so the policy applies to every candidate — there is no "pure
 * inheritance" exemption here.
 */
export interface ModelSelectionPolicy {
  readonly routes?: readonly ModelRoute[] | undefined
}

/** The agent document fields chain resolution reads; plain data, nothing else. */
export interface ChainResolutionInput {
  /** Address key, for the report and for the hard error's message. */
  readonly agentName: string
  /** Alias names, tried in declaration order before {@link model}. */
  readonly modelOrder?: readonly string[] | undefined
  /** Legacy direct provider/model chain, tried after `modelOrder` is exhausted (D5). */
  readonly model?: readonly AgentModelTarget[] | undefined
  /** Agent-level effort default; a chain item's own effort still wins (D7). */
  readonly reasoningEffort?: string | undefined
  /** Document body (正文): the persona channel, passed through untouched (D11). */
  readonly body: string
  /** Tool names the agent expects; passed through as the tool filter (D9). */
  readonly requiredTools?: readonly string[] | undefined
  /** Default flavor written in the document; the call site's override wins (D13). */
  readonly spawn?: 'spawn' | 'fork' | undefined
}

/** One step of the alias chain: the alias, and what its model entries led to. */
export interface AliasChainStep {
  /** Position in `modelOrder`, 0-based. */
  readonly orderIndex: number
  /** The alias name exactly as the document wrote it. */
  readonly alias: string
  /** Model entry names the alias points at, in pointer order (v1: one). */
  readonly targets: readonly string[]
  /** The registry entry that won from this alias, when one did. */
  readonly modelName?: string | undefined
  /**
   * Why the alias itself contributed nothing — set only for `unknown-alias`;
   * per-target refusals are reported per candidate in {@link ChainResolutionReport.candidates}.
   */
  readonly skipped?: Extract<ChainSkipReason, 'unknown-alias'> | undefined
}

/** One candidate the engine considered, wherever it came from. */
export interface ChainCandidateReport {
  /** Route being considered; absent only when the alias target is unknown. */
  readonly route?: ModelRoute | undefined
  readonly origin: ChainCandidateOrigin
  /** Registry model entry name; absent for `raw` candidates and unknown targets. */
  readonly modelName?: string | undefined
  /** `modelOrder` position this candidate came through; absent for `raw` candidates. */
  readonly orderIndex?: number | undefined
  /** Why it did not win, or that the chain stopped at an earlier target; absent on the winner. */
  readonly skipped?: ChainSkipReason | 'not-reached' | undefined
}

/** Which layer supplied the effective `reasoningEffort` (D7). */
export type EffortSource = 'chain' | 'agent' | 'none'

/** The full trace consumers render; same inputs always produce the same report. */
export interface ChainResolutionReport {
  /** The alias half, in declaration order. */
  readonly aliasChain: readonly AliasChainStep[]
  /** Whether the raw `model:` fallback was reached (spec §8 "escape hatch" warning). */
  readonly rawFallbackUsed: boolean
  /** Every candidate considered, alias half first, then raw, in declaration order. */
  readonly candidates: readonly ChainCandidateReport[]
  /** Why the winner won: first surviving alias target, or a raw entry; `none` when the chain ran out. */
  readonly selectedBy: 'alias' | 'raw' | 'none'
  /** Where the effective `reasoningEffort` came from. */
  readonly effortSource: EffortSource
}

/** A chain that resolved: the route plus what session start needs. */
export interface ChainResolutionSuccess {
  readonly ok: true
  readonly provider: string
  readonly model: string
  /** Chain item, then agent default, then absent (D7); never invented. */
  readonly reasoningEffort?: string | undefined
  /** Document body (正文), passed through; the persona channel (D11). */
  readonly persona: string
  /** Tool names the agent expects; warnable, never enforced here (D9). */
  readonly toolFilter: readonly string[]
  /** Effective flavor: the call site's override, else the document's, else `spawn` (D13). */
  readonly flavor: 'spawn' | 'fork'
  readonly report: ChainResolutionReport
}

/** A chain that ran out: the hard error, carried as data (docs/core-design §3.3). */
export interface ChainResolutionFailure {
  readonly ok: false
  /** Stable machine code; 07 maps it onto the tool `isError`. */
  readonly code: 'chain-exhausted'
  /** The hard error message, echoing the whole chain (D8); ready for `throw new Error(message)`. */
  readonly message: string
  readonly report: ChainResolutionReport
}

/** What chain resolution answers; a failure is data, never a throw. */
export type ChainResolution = ChainResolutionSuccess | ChainResolutionFailure

