/**
 * The field-form → raw-text compiler (ticket 11, Q5 ruling): the field form is
 * not a second data path — it compiles into an edit of the frontmatter's raw
 * text, and the raw text stays the only source of truth (D14).
 *
 * The compiler is a line splice over the raw text: it replaces, inserts or
 * removes exactly one top-level `key:` line (plus any indented block that
 * belongs to it), so comments, unknown keys and key order survive untouched.
 * Serialization is the same scalar subset the readers accept, so the edited
 * text parses back to the value that was written. Invariant: the result is
 * either `''` or ends with a newline — the newline the closing fence needs.
 */
import type { FrontmatterField, FrontmatterFieldValue } from './types.ts'

/** Fields that hold one string. */
const SCALAR_FIELDS: ReadonlySet<FrontmatterField> = new Set(['name', 'description', 'color', 'emoji', 'spawn', 'reasoningEffort'])
/** Fields that hold a list of strings. */
const ARRAY_FIELDS: ReadonlySet<FrontmatterField> = new Set(['modelOrder', 'requiredTools', 'skills'])

/** Result of compiling one field edit: the new text, or the reason it was refused. */
export type FrontmatterFieldResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string }

/** Top-level key line, anchored at column 0 (indented lines are block content). */
const KEY_LINE_RE = /^([A-Za-z0-9_.-]+):/

/**
 * Apply one field edit to the frontmatter's raw text.
 *
 * An empty array is the list fields' removal (the readers read an empty array
 * back as `undefined`, so writing `key: []` would be a value the round trip
 * does not preserve). Removing an absent key is a no-op.
 */
export function applyFrontmatterField(frontmatterText: string, field: FrontmatterField, value: FrontmatterFieldValue): FrontmatterFieldResult {
  const checked = checkValue(field, value)
  if (checked !== undefined) return { ok: false, reason: checked }
  const scalar = SCALAR_FIELDS.has(field)
  const empty = value === undefined || (Array.isArray(value) && value.length === 0)
  const line = empty ? undefined : `${field}: ${scalar ? serializeFrontmatterScalar(value as string) : serializeFrontmatterArray(value as readonly string[])}`
  return { ok: true, text: spliceKeyLine(frontmatterText, field, line) }
}

/** Reject a value whose shape does not fit the field, with a user-readable reason. */
function checkValue(field: FrontmatterField, value: FrontmatterFieldValue): string | undefined {
  if (!SCALAR_FIELDS.has(field) && !ARRAY_FIELDS.has(field)) return `unknown frontmatter field: ${field}`
  if (value === undefined) return undefined
  if (SCALAR_FIELDS.has(field)) {
    if (typeof value !== 'string') return `field "${field}" must be a string`
    if (field === 'spawn' && value !== 'spawn' && value !== 'fork') return `field "spawn" must be spawn or fork, got: ${value}`
    return undefined
  }
  if (typeof value !== 'object' || !Array.isArray(value)) return `field "${field}" must be an array of strings`
  if (!value.every((item) => typeof item === 'string')) return `field "${field}" must be an array of strings`
  return undefined
}

/**
 * Replace, insert or remove one top-level `key:` line, preserving every other
 * byte of the block.
 */
function spliceKeyLine(frontmatterText: string, field: string, line: string | undefined): string {
  const suffix = frontmatterText.endsWith('\n') ? '\n' : ''
  const body = suffix === '\n' ? frontmatterText.slice(0, -1) : frontmatterText
  const lines = body === '' ? [] : body.split('\n')
  const keyIndex = lines.findIndex((candidate) => KEY_LINE_RE.exec(candidate)?.[1] === field)
  if (line === undefined) {
    if (keyIndex < 0) {
      // True no-op for well-formed input (empty or \n-terminated); heal a
      // missing trailing newline so the compiler invariant still holds.
      if (frontmatterText === '' || suffix === '\n') return frontmatterText
      return `${frontmatterText}\n`
    }
    lines.splice(keyIndex, blockEnd(lines, keyIndex) - keyIndex)
  } else if (keyIndex < 0) {
    lines.push(line)
  } else {
    lines.splice(keyIndex, blockEnd(lines, keyIndex) - keyIndex, line)
  }
  if (lines.length === 0) return ''
  const text = lines.join('\n') + suffix
  // Keep the fenced invariant: non-empty frontmatter text ends with its newline.
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * End of the indented block that follows a key line (exclusive). Blank lines
 * end the block — they carry no value and belong to the surrounding layout.
 */
function blockEnd(lines: readonly string[], keyIndex: number): number {
  let end = keyIndex + 1
  while (end < lines.length && /^[\t ]/.test(lines[end] ?? '')) end += 1
  return end
}

/**
 * Serialize one scalar so the readers read the same string back: plain when
 * the subset reads it unambiguously, double-quoted (with `\\`, `\"`, `\n`,
 * `\t` escapes) otherwise.
 */
export function serializeFrontmatterScalar(text: string): string {
  return isPlainSafe(text) ? text : `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
}

/** Serialize a string list as the flow form the readers accept: `[a, b]`. */
export function serializeFrontmatterArray(items: readonly string[]): string {
  return `[${items.map(serializeFrontmatterScalar).join(', ')}]`
}

/**
 * Whether one scalar survives the round trip unquoted: no quoting or escape
 * indicators, no YAML boolean/null spelling, no comment or mapping starter,
 * and no leading or trailing whitespace.
 */
function isPlainSafe(text: string): boolean {
  if (text === '' || text !== text.trim()) return false
  if (/[\n\t\r:#['"{}&*!|>%@`\\]/.test(text)) return false
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(text)) return false
  if (/^[-?\]]/.test(text)) return false
  return /^[A-Za-z0-9_][A-Za-z0-9_ ./-]*$/.test(text)
}
