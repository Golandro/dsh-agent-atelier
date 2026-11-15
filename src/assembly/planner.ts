/**
 * The pure assembly planner (ticket 04): one resolved session in, one
 * {@link AssemblyPlan} out. Nothing here reads the host, a file or a registry
 * snapshot — the session already carries every input — so the same session and
 * config always produce the same plan, and the advisor panel and ticket 06's
 * warnings can render one derived value instead of keeping their own tables.
 *
 * The row set is fixed; only the model-system row is conditional (an entry
 * without `sysPrompt` contributes no empty section). Rows are listed in the
 * recommended cache layering (D10): per-model system prompt, tools field,
 * persona, preset skills, digest, first message, pre-step. Only `system` rows
 * carry a host placement order and only two of them are executable; the other
 * channels are anchors for 06/07 or for DSH itself.
 */
import type {
  AssemblyBreakpoint,
  AssemblyChannel,
  AssemblyConfig,
  AssemblyLint,
  AssemblyOrderEntry,
  AssemblyPlan,
  AssemblySection,
  AssemblySession,
  AssemblyVariesWith,
  ModelRoute,
} from '../contract/index.ts'

/** Name of the per-model system row this bundle registers. */
export const MODEL_SYSTEM_SECTION = 'atelier:model-sys'

/** Name of the host's deployment persona prefix, reused so a scoped row shadows it. */
export const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'

/** Name of the modeled preset-skills row (executed by ticket 07, not registered). */
export const SKILLS_SECTION = 'atelier:skills'

/** Name of the modeled tools-field anchor (ticket 07's filter). */
export const TOOLS_CHANNEL_SECTION = 'channel:tools'

/** Name of the modeled digest anchor (ticket 06's catalog summary). */
export const DIGEST_CHANNEL_SECTION = 'channel:digest'

/** Name of the modeled first-message anchor (ticket 07's brief). */
export const FIRST_MESSAGE_CHANNEL_SECTION = 'channel:first-message'

/** Name of the modeled pre-step anchor (native compaction / reminders). */
export const PRE_STEP_CHANNEL_SECTION = 'channel:pre-step'

/**
 * Host placement of the model-system row. It must sort before the deployment
 * persona prefix (order 0), so a model switch only rewrites the rows above the
 * persona.
 */
const MODEL_SYSTEM_ORDER = -500

/** Host placement of the persona row; the native prefix's own order. */
const PERSONA_ORDER = 0

/** Host placement of the preset-skills row, after the persona and before tools sections. */
const SKILLS_ORDER = 100

/**
 * Variation frequency, rarest first. The order lint compares these ranks: an
 * earlier system row whose rank is higher (varies more often) than the next
 * one breaks the prefix cache between them.
 */
const FREQUENCY: Readonly<Record<AssemblyVariesWith, number>> = {
  model: 0,
  registry: 1,
  tools: 2,
  agent: 3,
}

/** Stable output order of the breakpoint list. */
const DIMENSIONS: readonly AssemblyVariesWith[] = ['model', 'agent', 'registry', 'tools']

/**
 * Plan one resolved session.
 *
 * @param session - the agent, the resolved route and persona, and the winning
 *   registry entry when an alias target won.
 * @param config - optional global section-order overrides.
 * @returns the fixed row set in recommended (or overridden) order, one
 *   breakpoint per dependent dimension, and advisory lint findings.
 */
export function planAssembly(session: AssemblySession, config?: AssemblyConfig): AssemblyPlan {
  const sections = orderRows(recommendedRows(session), config?.sectionOrder)
  return { sections, breakpoints: breakpointsOf(sections), lints: lintsOf(sections) }
}

/** The recommended row set before any config override. */
function recommendedRows(session: AssemblySession): AssemblySection[] {
  const rows: AssemblySection[] = []
  const sysPrompt = session.model?.sysPrompt
  if (sysPrompt !== undefined && sysPrompt !== '') {
    rows.push({
      channel: 'system',
      name: MODEL_SYSTEM_SECTION,
      order: MODEL_SYSTEM_ORDER,
      variesWith: ['model'],
      text: substituteRoute(sysPrompt, session.parameters.route),
      interpolate: false,
      executable: true,
      cacheIsolated: false,
    })
  }
  rows.push(anchor('tools', TOOLS_CHANNEL_SECTION, ['tools']))
  rows.push({
    channel: 'system',
    name: PERSONA_PREFIX_SECTION,
    order: PERSONA_ORDER,
    variesWith: ['agent'],
    // An empty body stays a row: the scoped registration is what shadows the
    // deployment-wide persona, so "no persona" must not mean "inherit one".
    text: session.parameters.persona,
    executable: true,
    cacheIsolated: false,
  })
  rows.push({
    channel: 'system',
    name: SKILLS_SECTION,
    order: SKILLS_ORDER,
    variesWith: ['agent'],
    text: '',
    executable: false,
    cacheIsolated: false,
  })
  rows.push(anchor('digest', DIGEST_CHANNEL_SECTION, ['registry']))
  rows.push(anchor('first-message', FIRST_MESSAGE_CHANNEL_SECTION, []))
  rows.push(anchor('pre-step', PRE_STEP_CHANNEL_SECTION, []))
  return rows
}

/** One modeled channel anchor: no host placement, no executable text. */
function anchor(channel: AssemblyChannel, name: string, variesWith: readonly AssemblyVariesWith[]): AssemblySection {
  return { channel, name, order: 0, variesWith, text: '', executable: false, cacheIsolated: false }
}

/**
 * Substitute the only two variables the model-system row owns.
 *
 * The row carries `interpolate: false`, so any other `{{...}}` stays literal;
 * the persona row is left verbatim for the host's own interpolation.
 */
function substituteRoute(text: string, route: ModelRoute): string {
  return text.replaceAll('{{provider}}', route.provider).replaceAll('{{model}}', route.model)
}

/**
 * Apply `sectionOrder`: listed rows first in the given order, unlisted rows
 * appended in the recommended order. Unknown, duplicate and malformed entries
 * are ignored. With at least one listed row, system rows are renumbered by
 * array index; without any, the recommended placement is kept untouched.
 */
function orderRows(
  recommended: readonly AssemblySection[],
  sectionOrder: readonly AssemblyOrderEntry[] | undefined,
): AssemblySection[] {
  if (sectionOrder === undefined) return [...recommended]
  const byName = new Map(recommended.map((row) => [row.name, row]))
  const listed = new Map<string, { readonly row: AssemblySection; readonly cacheIsolated: boolean }>()
  for (const entry of sectionOrder) {
    const name = configuredName(entry)
    const row = name === undefined ? undefined : byName.get(name)
    if (name === undefined || row === undefined || listed.has(name)) continue
    listed.set(name, { row, cacheIsolated: configuredExemption(entry) })
  }
  if (listed.size === 0) return [...recommended]

  const rows = [...listed.values()].map(({ row, cacheIsolated }) => ({ ...row, cacheIsolated }))
  for (const row of recommended) {
    if (!listed.has(row.name)) rows.push(row)
  }
  return rows.map((row, index) => row.channel === 'system' ? { ...row, order: index } : { ...row, order: 0 })
}

/** The name an override entry names; a malformed entry is ignored. */
function configuredName(entry: AssemblyOrderEntry): string | undefined {
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null && typeof entry.name === 'string') return entry.name
  return undefined
}

/** Whether an override entry waives the volatile-before-stable lint for its row. */
function configuredExemption(entry: AssemblyOrderEntry): boolean {
  return typeof entry === 'object' && entry !== null && entry.cacheIsolated === true
}

/** The first row depending on each dimension, in the fixed dimension order. */
function breakpointsOf(sections: readonly AssemblySection[]): AssemblyBreakpoint[] {
  const breakpoints: AssemblyBreakpoint[] = []
  for (const dimension of DIMENSIONS) {
    const hit = sections.find((section) => section.variesWith.includes(dimension))
    if (hit !== undefined) breakpoints.push({ dimension, channel: hit.channel, section: hit.name })
  }
  return breakpoints
}

/**
 * Compare adjacent system rows by host order.
 *
 * Only system rows share one cached prefix, so only they are compared. An
 * earlier row that varies more often than the next one is the anti-pattern:
 * the frequently rewritten rows sit above the stable ones, and every change
 * rebuilds everything below. `cacheIsolated` waives the warning; it never
 * changes placement.
 */
function lintsOf(sections: readonly AssemblySection[]): AssemblyLint[] {
  const systemRows = sections
    .filter((section) => section.channel === 'system')
    .sort((left, right) => left.order - right.order || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const lints: AssemblyLint[] = []
  for (let index = 1; index < systemRows.length; index += 1) {
    const earlier = systemRows[index - 1]
    const later = systemRows[index]
    if (earlier === undefined || later === undefined || earlier.cacheIsolated) continue
    const earlierDimension = mostFrequent(earlier.variesWith)
    const laterDimension = mostFrequent(later.variesWith)
    if (rankOf(earlierDimension) <= rankOf(laterDimension)) continue
    lints.push({
      code: 'volatile-before-stable',
      severity: 'warning',
      channel: 'system',
      section: earlier.name,
      message: `system section "${earlier.name}" (varies with ${earlierDimension ?? 'nothing'}) sits before `
        + `"${later.name}" (varies with ${laterDimension ?? 'nothing'}); switching that dimension rebuilds the prefix cache `
        + 'below it. Reorder it, or mark it cacheIsolated in sectionOrder if the order is intentional.',
    })
  }
  return lints
}

/** The most frequent (most volatile) dimension of a row; `undefined` for a natural tail. */
function mostFrequent(dimensions: readonly AssemblyVariesWith[]): AssemblyVariesWith | undefined {
  let found: AssemblyVariesWith | undefined
  for (const dimension of dimensions) {
    if (found === undefined || FREQUENCY[dimension] > FREQUENCY[found]) found = dimension
  }
  return found
}

/** Frequency rank; a row with no dimension is the most stable (-1). */
function rankOf(dimension: AssemblyVariesWith | undefined): number {
  return dimension === undefined ? -1 : FREQUENCY[dimension]
}
