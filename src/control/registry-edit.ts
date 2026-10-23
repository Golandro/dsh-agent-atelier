/**
 * Registry tuning edits (ticket 11): one `RegistryEdit` lands in exactly one
 * registry.yaml layer file, as a line splice over its raw text.
 *
 * The layer resolution is the part this module exists for: a
 * `setAvailable`/`setSysPrompt`/`deleteModel` edit resolves the *effective*
 * model definition through the alias registry and writes the file that
 * declaration lives in — built-in and synthesized entries are read-only —
 * while `addAlias`/`addModel` name their layer explicitly and take the path
 * from `aliasRegistryLayers`, so the precedence rule lives in one place.
 *
 * Surgery reuses the readers' scalar rules (via the control field compiler's
 * serializers) and validates the result with `readRegistryLayer` before a byte
 * is written, so a layer is edited whole or not at all — the same
 * whole-or-dropped discipline the read side has (triage Q4).
 */
import { aliasRegistryLayers, DEFAULT_ALIAS_NAME, readRegistryLayer } from '../core/index.ts'

import type { AliasRegistry } from '../contract/index.ts'
import type { ControlFileSystem } from '../core/ports.ts'
import { errorMessage } from './client-errors.ts'
import { serializeFrontmatterScalar } from './frontmatter-edit.ts'
import { atomicWriteFile } from './writes.ts'
import type { RegistryEdit, WriteReport, WriteResult } from './types.ts'

/** Everything a registry edit needs from the control core. */
export interface RegistryEditContext {
  readonly aliasRegistry: AliasRegistry
  readonly fileSystem: ControlFileSystem
  /** Resolves the workspace root at call time; `undefined` means no workspace. */
  readonly resolveProjectRoot: () => string | undefined
  readonly dshHome: string
  readonly warn?: ((message: string) => void) | undefined
}

/** Registry entry names share the key charset; the built-in pointer stays reserved. */
const NAME_RE = /^[A-Za-z0-9_.-]+$/

/**
 * Apply one registry edit and return its single-row report. The alias registry
 * is invalidated after a successful write, so the next query re-reads the
 * layers; a refused edit changes nothing.
 */
export async function applyRegistryEdit(edit: RegistryEdit, context: RegistryEditContext): Promise<WriteReport> {
  const projectRoot = context.resolveProjectRoot()
  const resolved = await resolveEditFile(edit, context, projectRoot)
  if (resolved.ok === false) return { results: [resolved.result] }
  const file = resolved.file

  let current: string
  try {
    current = (await context.fileSystem.readTextFile(file)) ?? ''
  } catch (error) {
    return { results: [{ ok: false, file, code: 'io-error', message: errorMessage(error) }] }
  }
  // A broken layer is never spliced: the read side dropped it whole, so the
  // write side refuses it whole until a human fixes the text.
  const before = readRegistryLayer(current)
  if (!before.ok) {
    return refusal(context, file, 'invalid-content', `layer file does not parse, refusing to edit it: ${file}: ${describe(before)}`)
  }

  const { lines, suffix } = toEditableLines(current)
  const spliced = spliceEdit(lines, suffix, edit, before.data, file)
  if (spliced.ok === false) return refusal(context, file, 'invalid-edit', spliced.message)

  const after = readRegistryLayer(spliced.text)
  if (!after.ok) {
    return refusal(context, file, 'invalid-content', `edit would produce an invalid layer: ${describe(after)}`)
  }
  const written = await atomicWriteFile(file, spliced.text, context.fileSystem)
  if (written.ok) context.aliasRegistry.invalidate()
  return { results: [written] }
}

/** A refusal that also logs — the only diagnostic sink a registry edit has. */
function refusal(context: RegistryEditContext, file: string, code: 'invalid-content' | 'invalid-edit', message: string): WriteReport {
  context.warn?.(`registry edit refused (${code}) at ${file}: ${message}`)
  const result: WriteResult = { ok: false, file, code, message }
  return { results: [result] }
}

/** Join a layer read's failures into one line. */
function describe(read: { readonly ok: false; readonly failures: readonly { readonly message: string }[] }): string {
  return read.failures.map((failure) => failure.message).join('; ')
}

/**
 * Which file an edit targets, refusing the cases the type system cannot see:
 * unknown entries, built-in or synthesized definitions, and an add that names
 * a layer the workspace cannot provide.
 */
async function resolveEditFile(
  edit: RegistryEdit,
  context: RegistryEditContext,
  projectRoot: string | undefined,
): Promise<{ readonly ok: true; readonly file: string } | { readonly ok: false; readonly result: WriteResult }> {
  if (edit.kind === 'addAlias' || edit.kind === 'addModel') {
    const nameProblem = checkEntryName(edit.kind === 'addAlias' ? edit.alias : edit.modelName)
    if (nameProblem !== undefined) return refusalResult('invalid-edit', nameProblem)
    if (edit.kind === 'addAlias') {
      if (edit.target === '') return refusalResult('invalid-edit', 'alias target must not be empty')
      const target = await context.aliasRegistry.getModel(edit.target, { cwd: projectRoot })
      if (target === undefined) return refusalResult('invalid-edit', `alias target "${edit.target}" is not a model the registry has`)
    } else {
      if (edit.provider === '' || edit.model === '') return refusalResult('invalid-edit', 'a model entry requires a non-empty provider and model')
    }
    const layer = aliasRegistryLayers(projectRoot, context.dshHome).find((candidate) => candidate.source === edit.source)
    if (layer === undefined) return refusalResult('invalid-edit', `no ${edit.source} layer is available: the workspace has no project root`)
    return { ok: true, file: layer.path }
  }
  const isAliasEdit = edit.kind === 'remapAlias' || edit.kind === 'deleteAlias'
  const lookup = isAliasEdit
    ? await context.aliasRegistry.getAlias(edit.alias, { cwd: projectRoot })
    : await context.aliasRegistry.getModel(edit.modelName, { cwd: projectRoot })
  if (lookup === undefined) {
    const name = isAliasEdit ? edit.alias : edit.modelName
    return refusalResult('not-found', `registry has no entry named "${name}"`)
  }
  if (lookup.source === 'built-in' || lookup.path === undefined) {
    return refusalResult('read-only', `"${lookup.source}" entries are not user-editable`)
  }
  return { ok: true, file: lookup.path }
}

function refusalResult(code: 'invalid-edit' | 'not-found' | 'read-only', message: string): { readonly ok: false; readonly result: WriteResult } {
  return { ok: false, result: { ok: false, file: undefined, code, message } }
}

/** Reject a reserved or malformed entry name before any file is touched. */
function checkEntryName(name: string): string | undefined {
  if (name === DEFAULT_ALIAS_NAME) return `"${name}" is reserved for the built-in alias`
  if (!NAME_RE.test(name)) return `"${name}" is not a valid registry entry name (expected ${NAME_RE.source})`
  return undefined
}

/** One top-level section of a registry file: the `key:` line and its entry indent. */
interface Section {
  readonly index: number
  /** Indent of the entries under the section; `-1` when the section is empty. */
  readonly entryIndent: number
}

/** Outcome of the line splice: the new layer text, or why the edit cannot land. */
type SpliceOutcome = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string }

/** The layer declarations an edit checks for duplicate names before splicing. */
interface LayerDeclarations {
  readonly models: readonly { readonly modelName: string }[]
  readonly aliases: readonly { readonly alias: string }[]
}

/**
 * Run the line splice for one edit against the layer text. The splice only
 * touches the lines the edit names; comments, unknown keys and sibling entries
 * survive untouched, exactly as the frontmatter compiler does.
 */
function spliceEdit(lines: string[], suffix: string, edit: RegistryEdit, before: LayerDeclarations, file: string): SpliceOutcome {
  switch (edit.kind) {
    case 'setAvailable': {
      const entry = findModelEntry(lines, edit.modelName, file)
      if (entry.ok === false) return entry
      const end = entryBlockEnd(lines, entry.entryIndex, entry.section.entryIndent)
      setOrInsertField(lines, entry.entryIndex, end, entry.section.entryIndent, 'available', `available: ${edit.available ? 'true' : 'false'}`)
      break
    }
    case 'setSysPrompt': {
      const entry = findModelEntry(lines, edit.modelName, file)
      if (entry.ok === false) return entry
      const end = entryBlockEnd(lines, entry.entryIndex, entry.section.entryIndent)
      // An empty prompt is the readers' "absent": remove the line instead of writing `''`.
      const value = edit.sysPrompt === '' ? undefined : edit.sysPrompt
      if (value === undefined) {
        const fieldIndex = findFieldLine(lines, entry.entryIndex + 1, end, 'sysPrompt')
        if (fieldIndex >= 0) lines.splice(fieldIndex, 1)
      } else {
        setOrInsertField(lines, entry.entryIndex, end, entry.section.entryIndent, 'sysPrompt', `sysPrompt: ${serializeFrontmatterScalar(value)}`)
      }
      break
    }
    case 'remapAlias': {
      const section = findSection(lines, 'aliases')
      if (section === undefined) return { ok: false, message: `aliases section is missing in ${file}` }
      const entryIndex = findEntryLine(lines, section, edit.alias)
      if (entryIndex < 0) return { ok: false, message: `alias "${edit.alias}" is not in ${file}` }
      // A block-sequence alias (`- item` lines under the entry) is the long
      // form of the same value: remapping replaces the whole entry, or the
      // stale target lines would survive as a dangling block.
      lines.splice(
        entryIndex,
        entryBlockEnd(lines, entryIndex, section.entryIndent) - entryIndex,
        `${' '.repeat(section.entryIndent)}${edit.alias}: [${serializeFrontmatterScalar(edit.target)}]`,
      )
      break
    }
    case 'deleteAlias': {
      const section = findSection(lines, 'aliases')
      if (section === undefined) return { ok: false, message: `aliases section is missing in ${file}` }
      const entryIndex = findEntryLine(lines, section, edit.alias)
      if (entryIndex < 0) return { ok: false, message: `alias "${edit.alias}" is not in ${file}` }
      lines.splice(entryIndex, entryBlockEnd(lines, entryIndex, section.entryIndent) - entryIndex)
      break
    }
    case 'deleteModel': {
      const section = findSection(lines, 'models')
      if (section === undefined) return { ok: false, message: `models section is missing in ${file}` }
      const entryIndex = findEntryLine(lines, section, edit.modelName)
      if (entryIndex < 0) return { ok: false, message: `model "${edit.modelName}" is not in ${file}` }
      lines.splice(entryIndex, entryBlockEnd(lines, entryIndex, section.entryIndent) - entryIndex)
      break
    }
    case 'addAlias': {
      if (before.aliases.some((entry) => entry.alias === edit.alias)) {
        return { ok: false, message: `alias "${edit.alias}" already exists in ${file}` }
      }
      const section = ensureSection(lines, 'aliases')
      const pad = ' '.repeat(section.entryIndent >= 0 ? section.entryIndent : 2)
      lines.splice(sectionInsertIndex(lines, section), 0, `${pad}${edit.alias}: [${serializeFrontmatterScalar(edit.target)}]`)
      break
    }
    case 'addModel': {
      if (before.models.some((entry) => entry.modelName === edit.modelName)) {
        return { ok: false, message: `model "${edit.modelName}" already exists in ${file}` }
      }
      const section = ensureSection(lines, 'models')
      const indent = section.entryIndent >= 0 ? section.entryIndent : 2
      const pad = ' '.repeat(indent)
      const fieldPad = ' '.repeat(indent + 2)
      const entryLines = [
        `${pad}${edit.modelName}:`,
        `${fieldPad}provider: ${serializeFrontmatterScalar(edit.provider)}`,
        `${fieldPad}model: ${serializeFrontmatterScalar(edit.model)}`,
      ]
      if (edit.sysPrompt !== undefined && edit.sysPrompt !== '') entryLines.push(`${fieldPad}sysPrompt: ${serializeFrontmatterScalar(edit.sysPrompt)}`)
      // Absent means available, so only the explicit `false` is written.
      if (edit.available === false) entryLines.push(`${fieldPad}available: false`)
      lines.splice(sectionInsertIndex(lines, section), 0, ...entryLines)
      break
    }
  }
  return { ok: true, text: fromEditableLines(lines, suffix) }
}

/** Locate one model entry's line, or explain why the edit cannot land. */
function findModelEntry(
  lines: readonly string[],
  modelName: string,
  file: string,
): { readonly ok: true; readonly entryIndex: number; readonly section: Section } | { readonly ok: false; readonly message: string } {
  const section = findSection(lines, 'models')
  if (section === undefined) return { ok: false, message: `models section is missing in ${file}` }
  const entryIndex = findEntryLine(lines, section, modelName)
  if (entryIndex < 0) return { ok: false, message: `model "${modelName}" is not in ${file}` }
  return { ok: true, entryIndex, section }
}

/** Replace a field line inside one entry's block, or append it at the block's end. */
function setOrInsertField(lines: string[], entryIndex: number, end: number, entryIndent: number, field: string, rendered: string): void {
  const fieldIndex = findFieldLine(lines, entryIndex + 1, end, field)
  if (fieldIndex >= 0) {
    const line = lines[fieldIndex] ?? ''
    lines[fieldIndex] = `${' '.repeat(indentOf(line))}${rendered}`
    return
  }
  const fieldIndent = blockFieldIndent(lines, entryIndex + 1, end, entryIndent)
  lines.splice(end, 0, `${' '.repeat(fieldIndent)}${rendered}`)
}

/** Ensure a top-level section exists, normalizing the inline-empty `key: {}` form. */
function ensureSection(lines: string[], key: 'models' | 'aliases'): Section {
  const existing = findSection(lines, key)
  if (existing !== undefined) {
    const line = lines[existing.index] ?? ''
    if (line.trimEnd() === `${key}: {}`) lines[existing.index] = `${key}:`
    return existing
  }
  if (lines.length > 0) lines.push('')
  lines.push(`${key}:`)
  const section = findSection(lines, key)
  if (section !== undefined) return section
  // Unreachable: the section was just appended.
  return { index: lines.length - 1, entryIndent: -1 }
}

/** Find a top-level `key:` section, with the indent its entries use. */
function findSection(lines: readonly string[], key: 'models' | 'aliases'): Section | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.startsWith(`${key}:`)) continue
    return { index, entryIndent: sectionEntryIndent(lines, index) }
  }
  return undefined
}

/** Indent of a section's first entry; `-1` when the section holds no entries. */
function sectionEntryIndent(lines: readonly string[], sectionIndex: number): number {
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const indent = indentOf(line)
    return indent === 0 ? -1 : indent
  }
  return -1
}

/** Line index of one entry inside a section, or `-1` when it is not there. */
function findEntryLine(lines: readonly string[], section: Section, name: string): number {
  if (section.entryIndent < 0) return -1
  for (let index = section.index + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const indent = indentOf(line)
    if (indent === 0) break
    if (indent === section.entryIndent && line.slice(section.entryIndent).startsWith(`${name}:`)) return index
  }
  return -1
}

/** End (exclusive) of the indented block that follows an entry line. */
function entryBlockEnd(lines: readonly string[], entryIndex: number, entryIndent: number): number {
  let end = entryIndex + 1
  while (end < lines.length && indentOf(lines[end] ?? '') > entryIndent) end += 1
  return end
}

/** Line index of one `field:` line inside a half-open range, or `-1`. */
function findFieldLine(lines: readonly string[], start: number, end: number, field: string): number {
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? ''
    if (line.trimStart().startsWith(`${field}:`)) return index
  }
  return -1
}

/** Indent a new field line uses: the block's first field's, or the entry's + 2. */
function blockFieldIndent(lines: readonly string[], start: number, end: number, entryIndent: number): number {
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() !== '') return indentOf(line)
  }
  return entryIndent + 2
}

/** Insert position for a new entry: before the next top-level key, or EOF. */
function sectionInsertIndex(lines: readonly string[], section: Section): number {
  for (let index = section.index + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() !== '' && indentOf(line) === 0) return index
  }
  return lines.length
}

/** Split into editable lines, remembering whether the file ended with a newline. */
function toEditableLines(text: string): { readonly lines: string[]; readonly suffix: string } {
  const suffix = text.endsWith('\n') ? '\n' : ''
  const body = suffix === '\n' ? text.slice(0, -1) : text
  return { lines: body === '' ? [] : body.split('\n'), suffix }
}

/** Inverse of {@link toEditableLines}; an empty line list is an empty file. */
function fromEditableLines(lines: readonly string[], suffix: string): string {
  if (lines.length === 0) return ''
  return lines.join('\n') + suffix
}

/** Leading whitespace width of one line. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length
}
