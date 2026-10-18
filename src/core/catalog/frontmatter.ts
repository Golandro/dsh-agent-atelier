/**
 * Minimal YAML-subset frontmatter reader for agent documents (D23).
 *
 * The native skill loader parses frontmatter with the `yaml` package
 * (`skill/skill-filesystem/src/index.ts:812`), which this bundle cannot reach:
 * it ships with zero runtime dependencies (ADR-0001, enforced by
 * `scripts/check.mjs:188`). So this module hand-rolls exactly the subset the
 * agent schema needs — `---` fences, plain and quoted scalars, flow and block
 * string arrays, and `{provider, model}` flow mappings — and keeps every
 * unrecognised key as raw text so a later editor can write it back unchanged
 * (D14).
 *
 * Anything a *known* key would need but this subset cannot express becomes a
 * problem, and a document with problems is skipped with an
 * `unparseable-frontmatter` diagnostic rather than silently half-read.
 */
import { flowInner, splitTopLevel, stripComment, unquote } from './yaml-scalar.ts'

import type { AgentModelTarget } from '../../contract/index.ts'

/** Typed view of a document's frontmatter block. */
export interface AgentFrontmatter {
  readonly name?: string | undefined
  readonly description?: string | undefined
  readonly color?: string | undefined
  readonly emoji?: string | undefined
  /** Alias names, tried in order before the legacy array. */
  readonly modelOrder?: readonly string[] | undefined
  /** Legacy direct provider/model chain (D5 escape hatch). */
  readonly model?: readonly AgentModelTarget[] | undefined
  readonly requiredTools?: readonly string[] | undefined
  /** Preset skill names (D20). */
  readonly skills?: readonly string[] | undefined
  readonly spawn?: 'spawn' | 'fork' | undefined
  readonly reasoningEffort?: string | undefined
  /** Raw text of every unrecognised key, keyed by its name. */
  readonly extra: Readonly<Record<string, string>>
  /** Constructs the subset cannot express; non-empty means the document is skipped. */
  readonly problems: readonly string[]
}

/** One parsed agent document. */
export interface AgentDocument {
  /** Whether a `---` fenced block was found at the very start of the text. */
  readonly hasFrontmatter: boolean
  readonly frontmatter: AgentFrontmatter
  /** Document body (正文): everything after the closing fence, or the whole text when unfenced. */
  readonly body: string
}

const STRING_KEYS = ['name', 'description', 'color', 'emoji', 'spawn', 'reasoningEffort'] as const
const STRING_ARRAY_KEYS = ['modelOrder', 'requiredTools', 'skills'] as const
const MODEL_KEY = 'model'
const KNOWN_KEYS: ReadonlySet<string> = new Set<string>([...STRING_KEYS, ...STRING_ARRAY_KEYS, MODEL_KEY])
const KEY_RE = /^([A-Za-z0-9_.-]+):(.*)$/
const BLOCK_ITEM_RE = /^\s*-\s*(.*)$/
const INDENTED_RE = /^\s/

/** A frontmatter value before it is shaped for a specific key. */
type RawValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'scalar'; readonly text: string }
  | { readonly kind: 'sequence'; readonly items: readonly string[] }
  | { readonly kind: 'mapping'; readonly text: string }
  | { readonly kind: 'unsupported'; readonly text: string }

/** One key found in the block, with the raw text an unknown key keeps. */
interface RawEntry {
  readonly raw: string
  readonly value: RawValue
}

/** What the fence scan found. */
type Fence =
  | { readonly kind: 'closed'; readonly lines: readonly string[]; readonly body: string }
  | { readonly kind: 'unterminated' }

/**
 * Read one document into typed frontmatter plus the document body.
 *
 * A document without a frontmatter block is valid: every field defaults (D19),
 * and the whole text is the body.
 */
export function parseAgentDocument(text: string): AgentDocument {
  const fence = splitFence(text)
  const problems: string[] = []
  if (fence === undefined) {
    return { hasFrontmatter: false, frontmatter: { extra: {}, problems }, body: text.trim() }
  }
  if (fence.kind === 'unterminated') {
    problems.push('frontmatter opens with --- but never closes')
    return { hasFrontmatter: true, frontmatter: { extra: {}, problems }, body: '' }
  }
  return {
    hasFrontmatter: true,
    frontmatter: mapFrontmatter(parseEntries(fence.lines, problems), problems),
    body: fence.body.trim(),
  }
}

/** Split a leading `---` fenced block off the text, mirroring the native scanner. */
function splitFence(text: string): Fence | undefined {
  const firstLineEnd = text.indexOf('\n')
  /* v8 ignore next -- a document is a file, so it ends with a newline in practice. */
  if (firstLineEnd < 0) return undefined
  const firstLine = text.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  let lineStart = firstLineEnd + 1
  while (lineStart <= text.length) {
    const nextNewline = text.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? text.length : nextNewline
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      const bodyStart = nextNewline < 0 ? text.length : nextNewline + 1
      const lines = text.slice(firstLineEnd + 1, lineStart).split('\n').map((entry) => entry.replace(/\r$/, ''))
      return { kind: 'closed', lines, body: text.slice(bodyStart) }
    }
    if (nextNewline < 0) break
    lineStart = nextNewline + 1
  }
  return { kind: 'unterminated' }
}

/** Read every top-level key of the block, one entry per key. */
function parseEntries(lines: readonly string[], problems: string[]): Map<string, RawEntry> {
  const entries = new Map<string, RawEntry>()
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isIgnorable(line)) {
      index += 1
      continue
    }
    const match = KEY_RE.exec(line)
    if (match === null) {
      problems.push(`line ${index + 1} is neither a key nor an indented block: ${line.trim()}`)
      index += 1
      continue
    }
    const key = match[1] ?? ''
    const inline = (match[2] ?? '').trim()
    index += 1
    const blockLines: string[] = []
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (isIgnorable(next)) {
        index += 1
        continue
      }
      if (!INDENTED_RE.test(next)) break
      blockLines.push(next)
      index += 1
    }
    // Only a *known* key can make a document unreadable (spec §5.1): an unknown
    // key is kept as raw text whatever its value looks like, so the problems its
    // classification would report are discarded (D14 write-back).
    const known = KNOWN_KEYS.has(key)
    if (entries.has(key) && known) problems.push(`key "${key}" is declared more than once`)
    entries.set(key, classifyValue(key, inline, blockLines, known ? problems : []))
  }
  return entries
}

/** Classify one key's value: inline form, indented block form, or absent. */
function classifyValue(key: string, inline: string, blockLines: readonly string[], problems: string[]): RawEntry {
  const raw = inline !== '' ? inline : dedentBlock(blockLines)
  if (inline !== '') {
    if (blockLines.length > 0) {
      problems.push(`key "${key}" has both an inline value and an indented block`)
      return { raw, value: { kind: 'unsupported', text: inline } }
    }
    return { raw, value: classifyInline(inline, problems) }
  }
  if (blockLines.length > 0) {
    if (blockLines.every((line) => BLOCK_ITEM_RE.test(line))) {
      return { raw, value: { kind: 'sequence', items: blockLines.map((line) => (BLOCK_ITEM_RE.exec(line)?.[1] ?? '').trim()) } }
    }
    return { raw, value: { kind: 'mapping', text: raw } }
  }
  return { raw, value: { kind: 'absent' } }
}

/**
 * Raw text of an indented block value: drop exactly the block's own leading
 * indentation, keep every line's relative shape (D14). `trim()` would eat the
 * first line's indent only and make the value unwritable back unchanged.
 */
function dedentBlock(lines: readonly string[]): string {
  let common = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    if (indent < common) common = indent
  }
  if (!Number.isFinite(common)) return ''
  return lines.map((line) => line.slice(common)).join('\n').trimEnd()
}

/** Classify one inline value; syntax the subset cannot read becomes a problem. */
function classifyInline(text: string, problems: string[]): RawValue {
  if (text.startsWith('[')) return classifyFlowSequence(text, problems)
  if (text.startsWith('{')) {
    if (flowInner(text, '{', '}') === undefined) {
      problems.push(`unterminated flow mapping: ${text}`)
      return { kind: 'unsupported', text }
    }
    return { kind: 'mapping', text }
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = unquote(text)
    if (quoted === undefined) {
      problems.push(`unterminated quoted string: ${text}`)
      return { kind: 'unsupported', text }
    }
    return { kind: 'scalar', text: quoted }
  }
  if (/^[|>&*!%]/.test(text)) return { kind: 'unsupported', text }
  return { kind: 'scalar', text: stripComment(text).trim() }
}

/** Split a flow sequence into item texts. */
function classifyFlowSequence(text: string, problems: string[]): RawValue {
  const inner = flowInner(text, '[', ']')
  if (inner === undefined) {
    problems.push(`unterminated flow sequence: ${text}`)
    return { kind: 'unsupported', text }
  }
  const items = splitTopLevel(inner)
    .map((item) => item.trim())
    .filter((item) => item !== '')
  return { kind: 'sequence', items }
}

/** Project raw entries onto the agent schema. */
function mapFrontmatter(entries: Map<string, RawEntry>, problems: string[]): AgentFrontmatter {
  const extra: Record<string, string> = {}
  for (const [key, entry] of entries) {
    if (!KNOWN_KEYS.has(key)) extra[key] = entry.raw
  }
  const name = readString(entries, 'name', problems)
  const description = readString(entries, 'description', problems)
  const color = readString(entries, 'color', problems)
  const emoji = readString(entries, 'emoji', problems)
  const reasoningEffort = readString(entries, 'reasoningEffort', problems)
  const spawn = readSpawn(entries, problems)
  const modelOrder = readStringArray(entries, 'modelOrder', problems)
  const requiredTools = readStringArray(entries, 'requiredTools', problems)
  const skills = readStringArray(entries, 'skills', problems)
  const model = readModelTargets(entries, problems)
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(emoji !== undefined ? { emoji } : {}),
    ...(modelOrder !== undefined ? { modelOrder } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(requiredTools !== undefined ? { requiredTools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(spawn !== undefined ? { spawn } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    extra,
    problems,
  }
}

/** Read one scalar key; an absent or empty value reads as `undefined`. */
function readString(entries: Map<string, RawEntry>, key: string, problems: string[]): string | undefined {
  const value = entries.get(key)?.value
  if (value === undefined || value.kind === 'absent') return undefined
  if (value.kind !== 'scalar') {
    problems.push(`key "${key}" must be a string`)
    return undefined
  }
  return value.text.length > 0 ? value.text : undefined
}

/** Read one string-array key; an empty array reads as `undefined`. */
function readStringArray(entries: Map<string, RawEntry>, key: string, problems: string[]): readonly string[] | undefined {
  const value = entries.get(key)?.value
  if (value === undefined || value.kind === 'absent') return undefined
  if (value.kind !== 'sequence') {
    problems.push(`key "${key}" must be an array of strings`)
    return undefined
  }
  const items: string[] = []
  for (const item of value.items) {
    const text = unquote(item)
    if (text === undefined) {
      problems.push(`key "${key}" has an unterminated quoted item: ${item}`)
      continue
    }
    const trimmed = text.trim()
    if (trimmed === '') continue
    if (/^[[{|>&*!]/.test(trimmed)) {
      problems.push(`key "${key}" items must be strings, got: ${item}`)
      continue
    }
    items.push(trimmed)
  }
  return items.length > 0 ? items : undefined
}

/** Read the legacy `model:` chain of `{provider, model}` pairs. */
function readModelTargets(entries: Map<string, RawEntry>, problems: string[]): readonly AgentModelTarget[] | undefined {
  const value = entries.get(MODEL_KEY)?.value
  if (value === undefined || value.kind === 'absent') return undefined
  if (value.kind !== 'sequence') {
    problems.push('key "model" must be an array of {provider, model} mappings')
    return undefined
  }
  const targets: AgentModelTarget[] = []
  for (const item of value.items) {
    const target = parseModelTarget(item, problems)
    if (target !== undefined) targets.push(target)
  }
  return targets.length > 0 ? targets : undefined
}

/** Parse one `model:` item, in flow (`{a: b}`) or plain (`a: b, c: d`) form. */
function parseModelTarget(item: string, problems: string[]): AgentModelTarget | undefined {
  const text = item.trim()
  let inner: string
  if (text.startsWith('{')) {
    const flow = flowInner(text, '{', '}')
    if (flow === undefined) {
      problems.push(`key "model" has an unterminated mapping: ${text}`)
      return undefined
    }
    inner = flow
  } else if (text === '' || /^[[|>&*!]/.test(text)) {
    problems.push(`key "model" items must be {provider, model} mappings, got: ${text}`)
    return undefined
  } else {
    inner = stripComment(text)
  }
  const fields = new Map<string, string>()
  for (const part of splitTopLevel(inner)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const separator = trimmed.indexOf(':')
    if (separator <= 0) {
      problems.push(`key "model" mapping entry is not key: value: ${trimmed}`)
      return undefined
    }
    const fieldKey = trimmed.slice(0, separator).trim()
    const fieldValue = unquote(trimmed.slice(separator + 1).trim())
    if (fieldValue === undefined) {
      problems.push(`key "model" mapping entry has an unterminated string: ${trimmed}`)
      return undefined
    }
    if (fieldKey !== 'provider' && fieldKey !== 'model') {
      problems.push(`key "model" mappings only accept provider and model, got: ${fieldKey}`)
      return undefined
    }
    fields.set(fieldKey, fieldValue.trim())
  }
  const provider = fields.get('provider')
  const model = fields.get('model')
  if (provider === undefined || provider === '' || model === undefined || model === '') {
    problems.push(`key "model" mappings require both provider and model: ${text}`)
    return undefined
  }
  return { provider, model }
}

/** Read `spawn`, which only accepts the two flavors D13 defines. */
function readSpawn(entries: Map<string, RawEntry>, problems: string[]): 'spawn' | 'fork' | undefined {
  const value = readString(entries, 'spawn', problems)
  if (value === undefined) return undefined
  if (value !== 'spawn' && value !== 'fork') {
    problems.push(`key "spawn" must be spawn or fork, got: ${value}`)
    return undefined
  }
  return value
}

/** Blank lines and full-line comments carry no value. */
function isIgnorable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}
