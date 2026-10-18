/**
 * Provider contracts for the agent-definition read surface (ticket
 * `.scratch/agents-manager/issues/18-filesystem-provider-subplugin.md`).
 *
 * A provider is a *source adapter*: it lists raw entries and reads raw
 * documents from one origin, and nothing else. Frontmatter parsing,
 * classification, rank/trust merging and diagnostics stay in the registry, so
 * consumers only ever see the `AgentRegistry` read model and never need to
 * know heterogeneous providers.
 */

import type { AgentOrigin, AgentSource } from './types.ts'

/** Service key the core row provides and provider rows `inject`. */
export const AGENT_PROVIDERS_SERVICE = 'agentProviders'

/** Version of the `agentProviders` service contract and of every provider object on it. */
export const SERVICE_API_VERSION = 1

/** Options a provider receives for one query. */
export interface ProviderLookupOptions {
  readonly cwd?: string | undefined
  /**
   * Project root the registry resolved once for this query; `undefined` means
   * a user-level-only pass. Providers derive their root from it and never
   * resolve the project root themselves.
   */
  readonly projectRoot?: string | undefined
  readonly signal?: AbortSignal | undefined
}

/** One raw direct child a provider listed. */
export interface SourceEntry {
  readonly name: string
  readonly kind: 'file' | 'directory' | 'other'
  /**
   * Absolute path of this entry as the provider resolves it. Diagnostics quote
   * it verbatim; the registry never re-joins paths on its own.
   */
  readonly path: string
  /** The provider that listed this entry. */
  readonly providerId: string
  /** Provider-specific reference token; opaque to the registry. */
  readonly sourceRef?: string | undefined
}

/** One raw document a provider read. */
export interface SourceDocument {
  /** Absolute path of the document. */
  readonly path: string
  /** Raw text; the provider never parses frontmatter. */
  readonly text: string
}

/** Result of {@link AgentSourceProvider.readDocument}. */
export type SourceRead =
  | { readonly kind: 'text'; readonly document: SourceDocument }
  | {
      readonly kind: 'missing'
      /** Precise path of the document the provider looked for. */
      readonly path: string
      readonly reason: 'absent' | 'not-text' | 'unavailable'
    }

/** Control handle the providers registry hands to a provider factory. */
export interface ProviderControl {
  /** Aborts when the provider is unregistered. */
  readonly signal: AbortSignal
  /**
   * The provider's own data changed (e.g. its source moved). Clears the
   * registries' caches; the next query rescans.
   */
  invalidate(): void
}

/**
 * One agent-definition source adapter. It owns one origin: `listEntries`
 * returns that origin's raw direct children (no filtering — classification is
 * the registry's job), and `readDocument` reads one standard document per
 * listed entry. The provider never parses frontmatter, never merges ranks,
 * and never judges trust.
 */
export interface AgentSourceProvider {
  readonly id: string
  readonly source: AgentSource
  /** Lower merges earlier; ties keep registration order. */
  readonly rank: number
  readonly trust: 'trusted' | 'untrusted'
  readonly origin: AgentOrigin
  /** Definition format served; v1 only knows the standard agent document (Q4=B keeps the field). */
  readonly format: 'agent-md'
  readonly apiVersion: typeof SERVICE_API_VERSION
  /**
   * Raw direct children of this provider's root for one query, or `undefined`
   * when the root is absent (or unresolvable) for that query.
   */
  listEntries(options: ProviderLookupOptions): Promise<readonly SourceEntry[] | undefined>
  /**
   * Read the standard document of one listed entry. The path of a miss comes
   * from here; the registry maps every miss onto its existing diagnostics.
   */
  readDocument(entry: SourceEntry, options: ProviderLookupOptions): Promise<SourceRead>
}

/**
 * The plain-object service behind `ctx.agentProviders` — deliberately not in
 * the `Service` catalog, so provider rows can `inject` it (2026-10-18 probe,
 * `docs/agents/harness-facts.md`). This ticket only carries the agent side;
 * model/default providers stay in the design doc until their tickets.
 */
export interface AgentProviders {
  readonly apiVersion: typeof SERVICE_API_VERSION
  /**
   * Register one agent source provider; returns the disposer that unregisters
   * it and aborts its control signal. Duplicate `id` or duplicate agent
   * `source` throws.
   */
  registerAgentProvider(create: (control: ProviderControl) => AgentSourceProvider): () => void
  /** Registered providers, `rank` ascending, then registration order. */
  listAgentProviders(): readonly AgentSourceProvider[]
  /**
   * Fires on every register, unregister and `control.invalidate()`; returns
   * the unsubscriber.
   */
  onChange(listener: () => void): () => void
}
