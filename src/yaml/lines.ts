/**
 * YAML line-level text surgery shared by every reader and writer.
 *
 * One key-name charset, one top-level key splitter, one indentation measure.
 * The readers (`core/catalog/frontmatter.ts`, `core/catalog/registry-file.ts`)
 * and the writers (`control/frontmatter-edit.ts`, `control/registry-edit.ts`)
 * call these instead of spelling the same regex and whitespace rules again.
 * The wire pre-check stays its own defense-in-depth layer but uses the same
 * `KEY_NAME_RE`.
 *
 * Everything here works on raw text only: no schema, no meaning, no I/O.
 */

/** The one key-name charset: YAML keys and registry entry names share it. */
const KEY_NAME_BODY = '[A-Za-z0-9_.-]+'

/** Anchored key-name charset; use `.test(name)` for entry-name validation. */
export const KEY_NAME_RE = new RegExp(`^${KEY_NAME_BODY}$`)

const KEY_LINE_RE = new RegExp(`^(${KEY_NAME_BODY}):(.*)$`)

/** One `key:` line, at any indentation, split into its three parts. */
export interface SplitKeyLine {
  /** Leading whitespace width (tabs count as one column, matching the readers). */
  readonly indent: number
  readonly key: string
  /** Raw text after the colon, before comment stripping or trimming. */
  readonly inline: string
}

/** Leading whitespace width of one line. */
export function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/** Blank lines and full-line comments carry no value. */
export function isIgnorable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

/**
 * Split one `key:` line at any indentation. Returns `undefined` for a line
 * that is not a key line; the caller decides whether its indentation is legal
 * for the level it is reading.
 */
export function splitKeyLine(line: string): SplitKeyLine | undefined {
  const indent = indentOf(line)
  const match = KEY_LINE_RE.exec(line.slice(indent))
  if (match === null) return undefined
  return { indent, key: match[1] ?? '', inline: match[2] ?? '' }
}

/**
 * End (exclusive) of the indented block that follows a key line. The default
 * threshold is the key line's own indentation, so a top-level key ends at the
 * first column-0 line or blank line; a registry entry takes its entry indent
 * explicitly. Blank lines end the block — they belong to the surrounding layout.
 */
export function blockEnd(lines: readonly string[], keyIndex: number, indent = indentOf(lines[keyIndex] ?? '')): number {
  let end = keyIndex + 1
  while (end < lines.length && indentOf(lines[end] ?? '') > indent) end += 1
  return end
}
