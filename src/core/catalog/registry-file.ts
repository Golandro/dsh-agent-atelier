/**
 * The registry.yaml reader: one layer's file text in, validated model entries
 * and alias pointers out (ticket `.scratch/agents-manager/issues/02-alias-registry.md`,
 * scope item 5; schema in spec §5.2).
 *
 * Two maps are read, and only two: `models:` holds the real model entries the
 * tuning layer hangs on (D6 — per-model system prompt and the `available`
 * switch), and `aliases:` holds pure pointers to them (D18 — v1 is a
 * single-target array, so the pool form is R1/R2 work, not a schema change).
 *
 * This is a *second* minimal reader next to `./frontmatter.ts`, not a reuse of
 * it: registry.yaml needs booleans, a two-level block mapping and multi-field
 * flow mappings, none of which the agent-document subset can express. Both
 * readers sit on the scalar rules in `./yaml-scalar.ts`, and neither imports a
 * YAML library — `js-yaml` and `zod` stay declared in `package.json` as
 * reserved for the settings-UI work (2026-10-17 dependency ruling) — so the
 * bundle keeps exactly one YAML implementation.
 *
 * A layer is read whole or rejected whole (triage Q4): every problem is
 * collected, syntax problems come back as `unparseable-registry` and schema
 * problems as one `invalid-registry` finding each, and the caller drops the
 * layer with those findings instead of merging half of it.
 */
import { flowInner, splitTopLevel, stripComment, unquote } from './yaml-scalar.ts'

import type { AliasDeclaration, AliasDiagnosticCode, ModelDeclaration } from '../../contract/index.ts'

/**
 * Name of the built-in alias that follows the DSH sub-agent default pair.
 *
 * Reserved in both maps (triage Q3): the built-in pointer must stay
 * authoritative, so a user writing the name is a validation error rather than a
 * silent override.
 */
export const DEFAULT_ALIAS_NAME = 'dsh-default'

/** One real model entry: the tuning layer hangs on this (D6). */
export type ModelEntry = ModelDeclaration

/** One alias pointer: a name an agent's `modelOrder` may use (D5/D18). */
export type AliasEntry = AliasDeclaration

/** Everything one registry.yaml layer declares, in file order. */
export interface RegistryLayerData {
  readonly models: readonly ModelEntry[]
  readonly aliases: readonly AliasEntry[]
}

/** Why a whole layer was dropped; the same vocabulary the service reports it with. */
export type RegistryLayerFailureCode = AliasDiagnosticCode

/** One reason a layer was dropped; the path is added by the caller that read the file. */
export interface RegistryLayerFailure {
  readonly code: RegistryLayerFailureCode
  readonly message: string
}

/** One layer read: its data, or every reason it was rejected. */
export type RegistryLayerRead =
  | { readonly ok: true; readonly data: RegistryLayerData }
  | { readonly ok: false; readonly failures: readonly RegistryLayerFailure[] }

/** One source line, kept with its number so findings can point at it. */
interface Line {
  readonly text: string
  readonly number: number
}

/** One `key:` of a mapping level, with the indented block that follows it. */
interface BlockEntry {
  readonly key: string
  /** Text after the colon on the key's own line, comment stripped. */
  readonly inline: string
  readonly block: readonly Line[]
  readonly line: number
}

/** A scalar as the schema sees it: text, or a YAML boolean. */
type Scalar =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }

/** Result of reading a value that the schema expects to be a mapping. */
type FieldsResult =
  | { readonly kind: 'fields'; readonly fields: Map<string, Scalar> }
  | { readonly kind: 'shape' }
  | { readonly kind: 'syntax'; readonly problems: readonly string[] }

/** Result of reading a value that the schema expects to be a sequence. */
type ItemsResult =
  | { readonly kind: 'items'; readonly items: readonly string[] }
  | { readonly kind: 'shape' }
  | { readonly kind: 'syntax'; readonly problems: readonly string[] }

const LAYER_KEYS: ReadonlySet<string> = new Set(['models', 'aliases'])
const MODEL_FIELDS: ReadonlySet<string> = new Set(['provider', 'model', 'sysPrompt', 'available'])
const KEY_RE = /^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/
const BLOCK_ITEM_RE = /^-\s*(.*)$/

/**
 * Read one registry.yaml layer.
 *
 * A file that only declares one of the two maps is valid; a layer with no
 * entries at all is a layer with nothing to merge, not a problem.
 */
export function readRegistryLayer(text: string): RegistryLayerRead {
  const syntax: string[] = []
  const schema: string[] = []
  const models: ModelEntry[] = []
  const aliases: AliasEntry[] = []
  const levels = new Set<string>()

  for (const entry of collectEntries(toLines(text), syntax)) {
    if (!LAYER_KEYS.has(entry.key)) {
      schema.push(`unknown key "${entry.key}" at line ${entry.line}`)
      continue
    }
    if (levels.has(entry.key)) {
      schema.push(`key "${entry.key}" is declared more than once`)
      continue
    }
    levels.add(entry.key)
    if (entry.inline !== '' && entry.inline !== '{}') {
      schema.push(`"${entry.key}" must be a mapping of entries, got: ${entry.inline}`)
      continue
    }
    const nested = collectEntries(entry.block, syntax)
    if (entry.key === 'models') readModels(nested, models, schema, syntax)
    else readAliases(nested, aliases, schema, syntax)
  }

  // Unreadable syntax makes the schema picture unreliable, so it is reported on
  // its own; a layer the subset could not read is never half-merged.
  if (syntax.length > 0) return { ok: false, failures: [{ code: 'unparseable-registry', message: syntax.join('; ') }] }
  if (schema.length > 0) return { ok: false, failures: schema.map((message) => ({ code: 'invalid-registry', message })) }
  return { ok: true, data: { models, aliases } }
}

/** Read every `models:` entry. */
function readModels(entries: readonly BlockEntry[], models: ModelEntry[], schema: string[], syntax: string[]): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      schema.push(`model "${entry.key}" is declared more than once`)
      continue
    }
    seen.add(entry.key)
    if (entry.key === DEFAULT_ALIAS_NAME) {
      schema.push(`model name "${DEFAULT_ALIAS_NAME}" is reserved for the built-in alias`)
      continue
    }
    const read = readFields(entry)
    if (read.kind === 'syntax') {
      syntax.push(...read.problems)
      continue
    }
    if (read.kind === 'shape') {
      schema.push(`model "${entry.key}" must be a mapping of provider/model/sysPrompt/available (line ${entry.line})`)
      continue
    }
    const model = mapModelEntry(entry.key, read.fields, schema)
    if (model !== undefined) models.push(model)
  }
}

/** Project one entry's fields onto the model schema. */
function mapModelEntry(modelName: string, fields: Map<string, Scalar>, schema: string[]): ModelEntry | undefined {
  const problems: string[] = []
  for (const field of fields.keys()) {
    if (!MODEL_FIELDS.has(field)) problems.push(`model "${modelName}" has an unknown field "${field}"`)
  }
  const provider = readText(fields.get('provider'))
  const model = readText(fields.get('model'))
  const sysPrompt = readText(fields.get('sysPrompt'))
  if (!isFilled(provider)) problems.push(`model "${modelName}" requires a non-empty provider`)
  if (!isFilled(model)) problems.push(`model "${modelName}" requires a non-empty model`)
  const available = readAvailable(fields.get('available'), modelName, problems)
  // The `isFilled` pair is repeated here because the early return is what narrows
  // the two values to `string`; a bare `problems.length` check does not.
  if (!isFilled(provider) || !isFilled(model) || problems.length > 0) {
    schema.push(...problems)
    return undefined
  }
  return {
    modelName,
    provider,
    model,
    ...(sysPrompt === undefined || sysPrompt === '' ? {} : { sysPrompt }),
    available,
  }
}

/** Whether a field read produced a value worth keeping. */
function isFilled(text: string | undefined): text is string {
  return text !== undefined && text !== ''
}

/** Read every `aliases:` entry; v1 allows exactly one target each (D18). */
function readAliases(entries: readonly BlockEntry[], aliases: AliasEntry[], schema: string[], syntax: string[]): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      schema.push(`alias "${entry.key}" is declared more than once`)
      continue
    }
    seen.add(entry.key)
    if (entry.key === DEFAULT_ALIAS_NAME) {
      schema.push(`alias name "${DEFAULT_ALIAS_NAME}" is reserved for the built-in alias`)
      continue
    }
    const read = readItems(entry)
    if (read.kind === 'syntax') {
      syntax.push(...read.problems)
      continue
    }
    const shapeProblem = `alias "${entry.key}" must be an inline single-target array, e.g. ${entry.key}: [ds-chat] (line ${entry.line})`
    if (read.kind === 'shape') {
      schema.push(shapeProblem)
      continue
    }
    if (read.items.length !== 1 || (read.items[0] ?? '') === '') {
      schema.push(`alias "${entry.key}" must be a single-target array; got ${read.items.length} target(s)`)
      continue
    }
    aliases.push({ alias: entry.key, targets: [read.items[0] ?? ''] })
  }
}

/** Read a value the schema expects to be a mapping: a flow map, or a block map. */
function readFields(entry: BlockEntry): FieldsResult {
  if (entry.inline !== '') {
    if (!entry.inline.startsWith('{')) return { kind: 'shape' }
    if (entry.block.length > 0) {
      return { kind: 'syntax', problems: [`entry at line ${entry.line} has both an inline value and an indented block`] }
    }
    const inner = flowInner(entry.inline, '{', '}')
    if (inner === undefined) return { kind: 'syntax', problems: [`unterminated flow mapping at line ${entry.line}: ${entry.inline}`] }
    const fields = new Map<string, Scalar>()
    const problems: string[] = []
    for (const part of splitTopLevel(inner)) {
      const trimmed = part.trim()
      if (trimmed === '') continue
      const separator = trimmed.indexOf(':')
      if (separator <= 0) {
        problems.push(`mapping entry at line ${entry.line} is not key: value: ${trimmed}`)
        continue
      }
      const fieldKey = trimmed.slice(0, separator).trim()
      const scalar = readScalar(trimmed.slice(separator + 1).trim(), entry.line, problems)
      if (scalar === undefined) continue
      fields.set(fieldKey, scalar)
    }
    return problems.length > 0 ? { kind: 'syntax', problems } : { kind: 'fields', fields }
  }
  const problems: string[] = []
  const nested = collectEntries(entry.block, problems)
  const fields = new Map<string, Scalar>()
  for (const field of nested) {
    if (field.block.length > 0) {
      problems.push(`field "${field.key}" at line ${field.line} must hold an inline value`)
      continue
    }
    const scalar = readScalar(field.inline, field.line, problems)
    if (scalar === undefined) continue
    fields.set(field.key, scalar)
  }
  return problems.length > 0 ? { kind: 'syntax', problems } : { kind: 'fields', fields }
}

/** Read a value the schema expects to be a sequence of strings. */
function readItems(entry: BlockEntry): ItemsResult {
  const problems: string[] = []
  let items: readonly string[]
  if (entry.inline !== '') {
    if (!entry.inline.startsWith('[')) return { kind: 'shape' }
    const inner = flowInner(entry.inline, '[', ']')
    if (inner === undefined) return { kind: 'syntax', problems: [`unterminated flow sequence at line ${entry.line}: ${entry.inline}`] }
    items = readSequenceItems(splitTopLevel(inner), entry.line, problems)
  } else {
    // A block sequence (`- item` per line) is the long form of the same value.
    if (entry.block.length === 0) return { kind: 'shape' }
    const blocks = entry.block.filter((line) => !isIgnorable(line.text))
    if (!blocks.every((line) => BLOCK_ITEM_RE.test(line.text.trim()))) return { kind: 'shape' }
    items = readSequenceItems(blocks.map((line) => BLOCK_ITEM_RE.exec(line.text.trim())?.[1] ?? ''), entry.line, problems)
  }
  return problems.length > 0 ? { kind: 'syntax', problems } : { kind: 'items', items }
}

/** Unquote and filter the raw text of sequence items. */
function readSequenceItems(parts: readonly string[], line: number, problems: string[]): readonly string[] {
  const items: string[] = []
  for (const part of parts) {
    const text = unquote(stripComment(part).trim())
    if (text === undefined) {
      problems.push(`unterminated quoted string at line ${line}: ${part}`)
      continue
    }
    const trimmed = text.trim()
    if (trimmed === '') continue
    items.push(trimmed)
  }
  return items
}

/** Read one scalar token: text, or a YAML boolean. */
function readScalar(raw: string, line: number, problems: string[]): Scalar | undefined {
  const text = raw.trim()
  if (text.startsWith('"') || text.startsWith("'")) {
    const unquoted = unquote(text)
    if (unquoted === undefined) {
      problems.push(`unterminated quoted string at line ${line}: ${text}`)
      return undefined
    }
    return asScalar(unquoted.trim())
  }
  if (/^[[{|>&*!%@`]/.test(text)) {
    problems.push(`line ${line} uses syntax this reader cannot express: ${text}`)
    return undefined
  }
  return asScalar(stripComment(text).trim())
}

/** A bare token is a boolean when YAML says so, text otherwise. */
function asScalar(text: string): Scalar {
  if (text === 'true') return { kind: 'boolean', value: true }
  if (text === 'false') return { kind: 'boolean', value: false }
  return { kind: 'text', text }
}

/** Read a field that must hold text. */
function readText(scalar: Scalar | undefined): string | undefined {
  return scalar?.kind === 'text' ? scalar.text : undefined
}

/** Read the `available` switch; absent means available, anything else must be a boolean. */
function readAvailable(scalar: Scalar | undefined, modelName: string, problems: string[]): boolean {
  if (scalar === undefined) return true
  if (scalar.kind === 'boolean') return scalar.value
  // `asScalar` turns the only two boolean spellings into `boolean`, so anything
  // left here is a user writing YAML 1.1's `yes`/`no` or a quoted word.
  problems.push(`model "${modelName}" has available: ${scalar.text}, which must be true or false`)
  return true
}

/** Read one mapping level: every top-level `key:` with the block that follows it. */
function collectEntries(lines: readonly Line[], problems: string[]): readonly BlockEntry[] {
  const entries: BlockEntry[] = []
  let index = 0
  let levelIndent = -1
  while (index < lines.length) {
    const line = lines[index]
    /* v8 ignore next -- the loop condition keeps the index inside the array. */
    if (line === undefined) break
    if (isIgnorable(line.text)) {
      index += 1
      continue
    }
    const indent = indentOf(line.text)
    if (levelIndent < 0) levelIndent = indent
    if (indent < levelIndent) break
    if (indent > levelIndent) {
      problems.push(`line ${line.number} is indented deeper than its level: ${line.text.trim()}`)
      index += 1
      continue
    }
    const match = KEY_RE.exec(line.text.slice(indent))
    if (match === null) {
      problems.push(`line ${line.number} is neither a key nor an indented block: ${line.text.trim()}`)
      index += 1
      continue
    }
    const block: Line[] = []
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      /* v8 ignore next -- the loop condition keeps the index inside the array. */
      if (next === undefined) break
      if (isIgnorable(next.text)) {
        index += 1
        continue
      }
      if (indentOf(next.text) <= levelIndent) break
      block.push(next)
      index += 1
    }
    entries.push({ key: match[1] ?? '', inline: stripComment(match[2] ?? '').trim(), block, line: line.number })
  }
  return entries
}

/** Split the text into numbered lines, dropping the `\r` of CRLF files. */
function toLines(text: string): readonly Line[] {
  return text.split('\n').map((raw, index) => ({ text: raw.replace(/\r$/, ''), number: index + 1 }))
}

/** Leading whitespace width of one line. */
function indentOf(text: string): number {
  return text.length - text.trimStart().length
}

/** Blank lines and full-line comments carry no value. */
function isIgnorable(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '' || trimmed.startsWith('#')
}
