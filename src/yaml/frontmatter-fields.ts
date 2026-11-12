/**
 * The one frontmatter-field table.
 *
 * `FrontmatterField` (contract) is the type-level single source of truth; this
 * table adds the runtime fact the type cannot carry — whether a field is a
 * scalar or a string array — plus the one field order. Four consumers derive
 * from it instead of spelling their own list:
 *
 *   - the reader's known-key / value-shape table (`core/catalog/frontmatter.ts`)
 *   - the writer's scalar-vs-array compiler (`control/frontmatter-edit.ts`)
 *   - the wire's field whitelist (`dsh/host/wire.ts`)
 *   - discovery's projection into `AgentDefinition` (`core/catalog/discovery.ts`)
 *
 * Adding one editable field means adding it to the contract union and to this
 * table; every consumer follows without another list to update.
 */
import type { FrontmatterField } from '../contract/index.ts'

/** The runtime shape of one frontmatter field. */
export type FrontmatterFieldKind = 'scalar' | 'array'

/** One editable field: its key and its value shape. */
export interface FrontmatterFieldSpec {
  readonly key: FrontmatterField
  readonly kind: FrontmatterFieldKind
}

/**
 * Every editable frontmatter field, in the order the wire error message and
 * the field compiler have always used. Keep this order: it is user-visible.
 */
export const FRONTMATTER_FIELDS = [
  { key: 'name', kind: 'scalar' },
  { key: 'description', kind: 'scalar' },
  { key: 'color', kind: 'scalar' },
  { key: 'emoji', kind: 'scalar' },
  { key: 'spawn', kind: 'scalar' },
  { key: 'reasoningEffort', kind: 'scalar' },
  { key: 'modelOrder', kind: 'array' },
  { key: 'requiredTools', kind: 'array' },
  { key: 'skills', kind: 'array' },
] as const satisfies readonly FrontmatterFieldSpec[]

/** The same order as plain field names (wire messages, docs). */
export const FRONTMATTER_FIELD_KEYS: readonly FrontmatterField[] = FRONTMATTER_FIELDS.map((field) => field.key)

const KIND_BY_FIELD: ReadonlyMap<FrontmatterField, FrontmatterFieldKind> = new Map(
  FRONTMATTER_FIELDS.map((field) => [field.key, field.kind]),
)

/** Scalar fields, derived from the table. */
export const SCALAR_FRONTMATTER_FIELDS: ReadonlySet<FrontmatterField> = new Set(
  FRONTMATTER_FIELDS.filter((field) => field.kind === 'scalar').map((field) => field.key),
)

/** String-array fields, derived from the table. */
export const ARRAY_FRONTMATTER_FIELDS: ReadonlySet<FrontmatterField> = new Set(
  FRONTMATTER_FIELDS.filter((field) => field.kind === 'array').map((field) => field.key),
)

/** Whether a string names an editable frontmatter field. */
export function isFrontmatterField(value: string): value is FrontmatterField {
  return KIND_BY_FIELD.has(value as FrontmatterField)
}

/** The shape of one editable field; throws only for a field the union allows. */
export function frontmatterFieldKind(field: FrontmatterField): FrontmatterFieldKind {
  const kind = KIND_BY_FIELD.get(field)
  if (kind === undefined) throw new Error(`frontmatter field "${field}" is not in the field table`)
  return kind
}
