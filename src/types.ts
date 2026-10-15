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
