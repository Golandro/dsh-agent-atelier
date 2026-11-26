/**
 * Cross-package contract of the system-prompt preview (ticket 82/84): the
 * segmented-view DTOs a preview consumer renders.
 *
 * Why these live in the contract layer: the projection is produced by
 * `src/assembly/` but consumed across layers — the host read face returns it,
 * and the browser chunk reaches shared shapes only through
 * `src/dsh/client/chunk-contracts.ts` (the import matrix allows the chunk
 * nothing else). Neither the chunk layer nor `dsh/client` may read
 * `src/assembly/`, so a view type defined there would be unreachable by its own
 * consumer. The contract is the one place both sides may name.
 *
 * What does **not** live here:
 * - the host assembly mirrors (`AssembledSection` / `AssembledContext` /
 *   `ToolDeclaration` / `PromptAssembly`) — they are structural copies of host
 *   shapes, owned by `src/assembly/segments.ts`, and must not become contract;
 * - the registrant-side ledger record (`PromptSectionLedgerEntry`) — an
 *   assembly-domain concept, owned by the same module.
 *
 * These are plain data: no methods, no host types, no I/O, no imports at all.
 * Every field is JSON-serializable, so a view crosses any transport unchanged.
 */

/**
 * First-level source: the 7 contributor classes, split by **registrant role**
 * (spec §2).
 *
 * The vocabulary matches GLOSSARY.md「来源（Source）」; adding a source is a
 * contract change.
 */
export type PromptSourceId =
  /** ① The identity section the host `SystemPrompt` constructor registers inline. */
  | 'harness-identity'
  /** ② The `system-prompt` row config's persona prefix/suffix (deployment-wide). */
  | 'deployment-persona'
  /** ③ The preset scope's same-name persona section (shadows the deployment one). */
  | 'preset-persona'
  /** ④ Assembly rows this bundle's sink registers (the `atelier:` namespace). */
  | 'atelier-section'
  /** ⑤ Tool-guidance sections registered by tool plugins and executors (`tools:`). */
  | 'tool-guidance'
  /** ⑥ Runtime contexts from each plugin's `systemPrompt.context()`. */
  | 'runtime-context'
  /** ⑦ The `ToolsService` single provider's tool declarations (not in sections). */
  | 'tool-declaration'

/**
 * Which channel of the assembly product a segment came from.
 *
 * `section` and `context` are the host `assemble()` text channels; `tool` is a
 * tool declaration, which never appears in `sections` (spec §2 ⑦).
 */
export type PromptSegmentSurface = 'section' | 'context' | 'tool'

/** Part: a sub-block inside one section, recorded by the registrant. */
export interface PromptPart {
  readonly name: string
  readonly text: string
}

/**
 * A same-name shadowing record on one second-level key.
 *
 * In compat mode a scoped registration shadows the global one **before
 * evaluation**, so the product only keeps the winner; this record hangs on the
 * winner and the payload states the direction:
 * - `visible`: the ledger names where the displaced registration came from
 *   (`displaced`);
 * - `opaque`: the key is known to have been shadowed, but the displaced one is
 *   invisible — the UI must say「遮蔽关系不可见」and must not guess (ADR-0009
 *   consequence 2).
 *
 * The field name `shadowedBy` is the ticket's wording; the payload owns the
 * direction, because the product only has the winner.
 */
export type PromptShadow =
  | { readonly visibility: 'visible'; readonly displaced: string }
  | { readonly visibility: 'opaque' }

/** Fields shared by a segment with and without an attributed source. */
export interface PromptSegmentBase {
  /** Second-level key: the host assembly name (context name / tool name). */
  readonly name: string
  /** Which channel this segment came from. */
  readonly surface: PromptSegmentSurface
  /** Text from the assembly product (a tool declaration uses its description). */
  readonly text: string
  /** This bundle's plan name as an alias; absent = not recorded or equal to {@link name}. */
  readonly planName?: string | undefined
  /** Which config file the text came from; absent = the ledger did not record it. */
  readonly layer?: string | undefined
  /** Already rewritten by waterfall; absent = not recorded (not "not rewritten"). */
  readonly rewrittenByWaterfall?: boolean | undefined
  /** Shadowing record; absent = not recorded (not "not shadowed"). */
  readonly shadowedBy?: PromptShadow | undefined
  /** Parts; absent = the ledger recorded no parts (not "has no parts"). */
  readonly parts?: readonly PromptPart[] | undefined
}

/** One segment of the view: one second-level key under one first-level source. */
export interface PromptSegment extends PromptSegmentBase {
  /** First-level source. */
  readonly source: PromptSourceId
}

/**
 * A segment no first-level source could claim.
 *
 * The product carries no contributor field and the ledger did not record this
 * key, so the projection does not guess a source (ADR-0009「不撒谎」): it lists
 * these separately so the UI can show them honestly.
 */
export interface UnattributedPromptSegment extends PromptSegmentBase {
  readonly source?: undefined
}

/** One source group; empty groups are kept. */
export interface PromptSourceGroup {
  readonly source: PromptSourceId
  readonly segments: readonly PromptSegment[]
}

/** Diagnostic code. */
export type PromptSegmentDiagnosticCode =
  /** The plan name differs from the host assembly name: the host name wins. */
  | 'alias-mismatch'
  /** The ledger recorded a section the product does not contain (e.g. `executable: false`). */
  | 'missing-from-assembly'

/** One diagnostic signal; not an error, never thrown. */
export interface PromptSegmentDiagnostic {
  readonly code: PromptSegmentDiagnosticCode
  /** The second-level key involved (host assembly name). */
  readonly name: string
  /** One line, ready for the panel. */
  readonly message: string
}

/** The projection result: source groups + unattributable segments + diagnostics. */
/**
 * 7 条一级来源的固定顺序（契约事实，不是实现细节）。
 *
 * 视图契约本身承诺「组按固定顺序给齐、空组也保留」，所以顺序属于契约：任何
 * 消费方（宿主读面、降级档的占位视图、UI 排序）都必须按同一顺序读，且谁都不
 * 该自己再抄一份。装配层的投影函数从这里 import，不再本地定义。
 */
export const PROMPT_SOURCE_ORDER: readonly PromptSourceId[] = Object.freeze([
  'harness-identity',
  'deployment-persona',
  'preset-persona',
  'atelier-section',
  'tool-guidance',
  'runtime-context',
  'tool-declaration',
])

export interface PromptSegmentsView {
  /** 7 groups, always in the fixed source order (empty groups kept). */
  readonly sources: readonly PromptSourceGroup[]
  /** Segments no source could claim (listed instead of guessed). */
  readonly unattributed: readonly UnattributedPromptSegment[]
  readonly diagnostics: readonly PromptSegmentDiagnostic[]
}

/** One segment's part view: whether it expands, and the blocks it expands into. */
export interface PromptSegmentParts {
  /** Only a **multi-part** ledger record expands; one part or none renders whole. */
  readonly expandable: boolean
  /** Expanded parts; when not expandable, one part carrying the whole text (nothing lost). */
  readonly parts: readonly PromptPart[]
}
