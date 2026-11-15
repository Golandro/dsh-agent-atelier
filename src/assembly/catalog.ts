/**
 * The agent catalog (ticket 06): the pure projection the pre-step listener
 * publishes, its digest gate, and the single user message it appends.
 *
 * One registry pair in, one {@link CatalogSnapshot} out. The digest is a hash
 * over canonical JSON tuples (mode and completeness first), so identical
 * registries produce identical bytes and a changed registry produces exactly
 * one replacement message. Alias targets never enter the digest: a remap is a
 * routing decision, not a catalog name change.
 *
 * Nothing here reads the host, the filesystem, or a clock, and no hash is
 * imported: the host adapter injects the SHA-256 function and the message id,
 * which keeps this layer testable and deterministic (ADR-0001/0003).
 */
/** Hard bound of a rendered description, ellipsis included (reference default). */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 500

/** Stable source kind of every catalog message this bundle publishes. */
export const CATALOG_SOURCE_KIND = 'agents-catalog'

/** Hash function injected by the host adapter (SHA-256 hex in production). */
export type CatalogHash = (text: string) => string

/** One agent row: the stable address key plus what a chooser needs. */
export interface CatalogAgentEntry {
  readonly kind: 'agent'
  readonly agentName: string
  /** Display name; the projection already fell back to {@link agentName}. */
  readonly name: string
  /** One-line description, whitespace-folded and bounded; `''` renders nothing. */
  readonly description: string
  /** Alias names only; targets stay out of the catalog. */
  readonly modelOrder: readonly string[]
  /** Declared tool names absent from the effective tool surface, alphabetically sorted. */
  readonly missingTools: readonly string[]
  /** Declared preset skill names absent from the skill snapshot, alphabetically sorted. */
  readonly missingSkills: readonly string[]
}

/** One model-alias row: the name only, never its targets. */
export interface CatalogAliasEntry {
  readonly kind: 'alias'
  readonly alias: string
}

/** One catalog row, in registry order. */
export type CatalogEntry = CatalogAgentEntry | CatalogAliasEntry

/** The whole catalog value the digest and the renderer consume. */
export interface CatalogSnapshot {
  readonly entries: readonly CatalogEntry[]
  /** Current preset id (mode); absent when the preset service cannot answer. */
  readonly mode?: string | undefined
  /** Discovery could not confirm every row; the message says so. */
  readonly incomplete: boolean
}

/** One agent as discovery handed it to the projection. */
export interface CatalogAgentInput {
  readonly agentName: string
  readonly name: string
  readonly description: string
  readonly modelOrder?: readonly string[] | undefined
  readonly missingTools?: readonly string[] | undefined
  readonly missingSkills?: readonly string[] | undefined
}

/** Raw projection input: registry order preserved, nothing re-sorted by name. */
export interface CatalogProjectionInput {
  readonly agents: readonly CatalogAgentInput[]
  readonly aliases: readonly string[]
  readonly mode?: string | undefined
  readonly incomplete: boolean
}

/**
 * Project the registries into the catalog value.
 *
 * Entries stay in registry order; only the warning lists sort, so the same
 * registry always produces the same order. An empty display name falls back
 * to the address key, and a blank description stays empty (the renderer omits
 * it rather than printing a placeholder).
 */
export function projectCatalog(input: CatalogProjectionInput): CatalogSnapshot {
  const entries: CatalogEntry[] = []
  for (const agent of input.agents) {
    entries.push({
      kind: 'agent',
      agentName: agent.agentName,
      name: agent.name === '' ? agent.agentName : agent.name,
      description: catalogDescription(agent.description),
      modelOrder: [...(agent.modelOrder ?? [])],
      missingTools: [...(agent.missingTools ?? [])].sort(),
      missingSkills: [...(agent.missingSkills ?? [])].sort(),
    })
  }
  for (const alias of input.aliases) entries.push({ kind: 'alias', alias })
  return {
    entries,
    ...input.mode === undefined ? {} : { mode: input.mode },
    incomplete: input.incomplete,
  }
}

/** Fold runs of whitespace and bound the result, ellipsis included. */
function catalogDescription(value: string): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= CATALOG_DESCRIPTION_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, CATALOG_DESCRIPTION_MAX_LENGTH - 3)}...`
}

/**
 * The canonical digest input: mode marker, completeness marker, then one JSON
 * tuple per entry joined by newlines. JSON quoting makes entry boundaries
 * unambiguous even when descriptions carry commas or newlines.
 */
export function catalogCanonicalText(snapshot: CatalogSnapshot): string {
  const lines: string[] = [
    snapshot.mode === undefined ? '' : JSON.stringify(['mode', snapshot.mode]),
    snapshot.incomplete ? 'incomplete' : '',
  ]
  for (const entry of snapshot.entries) {
    lines.push(JSON.stringify(entry.kind === 'agent'
      ? ['agent', entry.agentName, entry.name, entry.description, entry.modelOrder, entry.missingTools, entry.missingSkills]
      : ['alias', entry.alias]))
  }
  return lines.join('\n')
}

/** Hash the canonical form with the injected function (host: SHA-256). */
export function catalogDigest(snapshot: CatalogSnapshot, hash: CatalogHash): string {
  return hash(catalogCanonicalText(snapshot))
}

/** What the gate decided for this step. */
export interface CatalogPublishPlan {
  readonly action: 'keep' | 'remove' | 'replace' | 'append'
  /** True when the published message must declare that it replaces earlier catalogs. */
  readonly update: boolean
}

/** Gate input: the new digest and whatever catalog the step already carries. */
export interface CatalogGateInput {
  /** Digest of the catalog this step computed. */
  readonly digest: string
  /** Digest of a catalog message in the current step's admitted batch, if any. */
  readonly batchDigest?: string | undefined
  /** Digest of the latest catalog message visible in the session, if any. */
  readonly visibleDigest?: string | undefined
  /** Whether the computed catalog has no rows. */
  readonly newIsEmpty: boolean
}

/**
 * Decide the publication action for one step.
 *
 * A current-batch catalog is only step-admission state: an equal digest is
 * dropped, a different one is replaced in place. Without one, the visible
 * history decides: an equal digest adds nothing, a changed one appends a
 * replacement, and a first empty catalog adds nothing at all.
 */
export function planCatalogPublish(input: CatalogGateInput): CatalogPublishPlan {
  if (input.batchDigest !== undefined) {
    return input.batchDigest === input.digest
      ? { action: 'remove', update: false }
      : { action: 'replace', update: true }
  }
  if (input.visibleDigest !== undefined) {
    return input.visibleDigest === input.digest
      ? { action: 'keep', update: false }
      : { action: 'append', update: true }
  }
  if (input.newIsEmpty) return { action: 'keep', update: false }
  return { action: 'append', update: false }
}

/** Publisher identity fields carried on the durable source. */
export interface CatalogSource {
  readonly kind: typeof CATALOG_SOURCE_KIND
  readonly form: 'catalog'
  readonly entries: readonly CatalogEntry[]
  readonly mode?: string | undefined
  readonly incomplete?: true | undefined
  readonly update?: true | undefined
}

/** One model-facing text block. */
export interface CatalogTextBlock {
  readonly type: 'text'
  readonly text: string
}

/** The exact message shape the pre-step listener appends. */
export interface CatalogMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly CatalogTextBlock[]
  readonly source: CatalogSource
}

/** Build the durable source payload from a snapshot. */
export function catalogSourcePayload(snapshot: CatalogSnapshot, update: boolean): CatalogSource {
  return {
    kind: CATALOG_SOURCE_KIND,
    form: 'catalog',
    entries: snapshot.entries,
    ...snapshot.mode === undefined ? {} : { mode: snapshot.mode },
    ...snapshot.incomplete ? { incomplete: true as const } : {},
    ...update ? { update: true as const } : {},
  }
}

/** Build the frozen user message: one text block, fresh id, durable source. */
export function createCatalogMessage(input: {
  readonly snapshot: CatalogSnapshot
  readonly update: boolean
  readonly id: string
}): CatalogMessage {
  return deepFreeze({
    id: input.id,
    role: 'user' as const,
    content: [{ type: 'text' as const, text: renderCatalog(input.snapshot, { update: input.update }) }],
    source: catalogSourcePayload(input.snapshot, input.update),
  })
}

/**
 * Read a durable catalog source back.
 *
 * Resumed and seeded sessions validate only that `source.kind` is a non-empty
 * string, so a foreign, unreadable or wrongly shaped payload is "not this
 * plugin's catalog": return undefined instead of throwing inside the listener.
 */
export function readCatalogSource(source: unknown): CatalogSnapshot | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const record = source as Record<string, unknown>
  if (record['kind'] !== CATALOG_SOURCE_KIND) return undefined
  if (!Array.isArray(record['entries'])) return undefined
  const entries: CatalogEntry[] = []
  for (const raw of record['entries']) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const entry = raw as Record<string, unknown>
    if (entry['kind'] === 'alias') {
      if (!nonEmpty(entry['alias'])) return undefined
      entries.push({ kind: 'alias', alias: entry['alias'] })
      continue
    }
    if (entry['kind'] !== 'agent') return undefined
    if (!nonEmpty(entry['agentName']) || typeof entry['name'] !== 'string' || typeof entry['description'] !== 'string') {
      return undefined
    }
    const modelOrder = stringArray(entry['modelOrder'])
    const missingTools = stringArray(entry['missingTools'])
    const missingSkills = stringArray(entry['missingSkills'])
    if (modelOrder === undefined || missingTools === undefined || missingSkills === undefined) return undefined
    entries.push({
      kind: 'agent',
      agentName: entry['agentName'],
      name: entry['name'],
      description: entry['description'],
      modelOrder,
      missingTools,
      missingSkills,
    })
  }
  const mode = record['mode']
  if (mode !== undefined && typeof mode !== 'string') return undefined
  const incomplete = record['incomplete']
  if (incomplete !== undefined && typeof incomplete !== 'boolean') return undefined
  return {
    entries,
    ...mode === undefined ? {} : { mode },
    incomplete: incomplete === true,
  }
}

/** Recompute the digest of a durable catalog source; undefined when unreadable. */
export function digestCatalogSource(source: unknown, hash: CatalogHash): string | undefined {
  const snapshot = readCatalogSource(source)
  return snapshot === undefined ? undefined : catalogDigest(snapshot, hash)
}

/** Non-empty string guard used by the source reader. */
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** String-array guard; undefined when the value is not an array of strings. */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every((item): item is string => typeof item === 'string') ? value : undefined
}

/** Recursively freeze a freshly built value (mirrors the host message contract). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** Model-facing text of one catalog message. */
export interface CatalogRenderOptions {
  /** True renders the replacement wording instead of the first-catalog wording. */
  readonly update: boolean
}

/**
 * Render the single English user message, wrapped in the system-reminder
 * frame. Names stay in backticks; free text is escaped so a description
 * cannot open a pseudo-markup section. Empty collections get a plain
 * sentence instead of an empty section.
 */
export function renderCatalog(snapshot: CatalogSnapshot, options: CatalogRenderOptions): string {
  const agents = snapshot.entries.filter((entry): entry is CatalogAgentEntry => entry.kind === 'agent')
  const aliases = snapshot.entries.filter((entry): entry is CatalogAliasEntry => entry.kind === 'alias')
  const lines: string[] = ['<system-reminder>']

  // The bundled `default` normally keeps the catalog non-empty; this branch
  // still guards the published contract for a registry that lists nothing.
  if (options.update && agents.length === 0 && aliases.length === 0) {
    lines.push('No expert agents or model aliases are currently available. This replaces every earlier agent or model catalog in this session; do not use names from earlier catalogs.')
  } else {
    lines.push(options.update
      ? 'The available agent and model catalog changed. This complete catalog replaces every earlier agent or model catalog in this session:'
      : 'The following expert agents and model aliases are available in this session:')
    lines.push('')
    if (agents.length > 0) {
      lines.push('<available_agents>', ...agents.map(renderAgentLine), '</available_agents>')
    } else {
      lines.push(snapshot.incomplete
        ? 'No expert agents could be confirmed in this discovery attempt.'
        : 'No expert agents are registered in this session.')
    }
    lines.push('')
    if (aliases.length > 0) {
      lines.push('<available_models>', ...aliases.map((entry) => `- \`${entry.alias}\``), '</available_models>')
    } else {
      lines.push('No model aliases are declared in this session.')
    }
  }

  if (snapshot.mode !== undefined) {
    lines.push('', `Current mode: \`${escapeText(snapshot.mode)}\`.`)
  }
  if (snapshot.incomplete) {
    lines.push('', 'Discovery is incomplete: this catalog may omit agents or models that exist.')
  }
  // The replacement wording must say the old names are no longer usable;
  // the first catalog adds no promise about what a later summon will do.
  if (options.update) {
    lines.push('', 'Use only the names in this replacement catalog; do not use names from earlier catalogs.')
  }
  lines.push('</system-reminder>')
  return lines.join('\n')
}

/** One agent line: address key, optional display name, description, warnings. */
function renderAgentLine(entry: CatalogAgentEntry): string {
  const display = entry.name === entry.agentName ? '' : ` (${escapeText(entry.name)})`
  const details: string[] = []
  if (entry.description !== '') details.push(escapeText(entry.description))
  if (entry.modelOrder.length > 0) details.push(`model order: ${entry.modelOrder.map(backtick).join(', ')}`)
  if (entry.missingTools.length > 0) details.push(`missing tools: ${entry.missingTools.map(backtick).join(', ')}`)
  if (entry.missingSkills.length > 0) details.push(`missing preset skills: ${entry.missingSkills.map(backtick).join(', ')}`)
  return `- \`${entry.agentName}\`${display}${details.length === 0 ? '' : ` — ${details.join('; ')}`}`
}

/** Backtick-wrap a stable name. */
function backtick(name: string): string {
  return `\`${name}\``
}

/** Escape the three characters that could open or close the pseudo-XML frame. */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
