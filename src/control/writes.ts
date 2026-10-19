/**
 * The write path (ticket 11): planning is a pure function from a composed
 * document plus edits to per-file write plans and rejections; committing is
 * atomic — temp file in the target directory, rename over the target,
 * post-write re-read — and never throws.
 *
 * Each accepted edit is validated as it is applied: the assembled document
 * must still parse, and an edit that breaks it is rolled back and rejected
 * instead of poisoning the rest. The plan entry carries the document text it
 * was planned against (`baseText`), so commit can refuse to overwrite a file
 * that changed on disk since it was composed.
 */
import { dirname } from 'node:path'

import { parseAgentDocument } from '../core/index.ts'

import type { ControlFileSystem } from '../core/ports.ts'
import { assembleAgentDocument } from './compose.ts'
import { applyFrontmatterField } from './frontmatter-edit.ts'
import type {
  BlockId,
  ComposedAgentDocument,
  DocumentEdit,
  WritePlan,
  WritePlanEntry,
  WriteRejection,
  WriteRejectionCode,
  WriteReport,
  WriteResult,
} from './types.ts'

/** One-line message of an unknown thrown value, for result rows that never throw. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Plan the writes for one composed document's edits — sync and pure: no I/O,
 * same inputs, same plan.
 *
 * Rejections are per edit (indexed into the caller's list); an edit the
 * document cannot absorb is refused without affecting the others. A net-zero
 * edit produces neither an entry nor a rejection.
 */
export function planDocumentEdits(doc: ComposedAgentDocument, edits: readonly DocumentEdit[]): WritePlan {
  const entries: WritePlanEntry[] = []
  const rejections: WriteRejection[] = []
  let frontmatterText = doc.frontmatterText
  let bodyText = doc.bodyText
  let dirty = false
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index]
    if (edit === undefined) break
    const reject = (code: WriteRejectionCode, message: string): void => {
      rejections.push({ code, message, editIndex: index })
    }
    if (edit.agentName !== doc.agentName) {
      reject('unknown-agent', `edit names agent "${edit.agentName}" but the document is "${doc.agentName}"`)
      continue
    }
    const previousFrontmatter = frontmatterText
    const previousBody = bodyText
    if (edit.kind === 'setBlockText') {
      if (edit.blockId === 'frontmatter') {
        if (doc.framing.kind === 'plain') {
          reject('unknown-block', `document "${doc.agentName}" has no frontmatter block to set`)
          continue
        }
        // Keep the fenced invariant: non-empty frontmatter text ends with its newline.
        const next = edit.text === '' || edit.text.endsWith('\n') ? edit.text : `${edit.text}\n`
        if (next !== frontmatterText) frontmatterText = next
      } else if (edit.text !== bodyText) {
        bodyText = edit.text
      }
    } else {
      const applied = applyFrontmatterField(frontmatterText, edit.field, edit.value)
      if (!applied.ok) {
        reject('invalid-field', applied.reason)
        continue
      }
      if (applied.text !== frontmatterText) frontmatterText = applied.text
    }
    const content = assembleAgentDocument(doc, frontmatterText, bodyText)
    const problems = parseAgentDocument(content).frontmatter.problems
    if (problems.length > 0) {
      frontmatterText = previousFrontmatter
      bodyText = previousBody
      reject('unparseable-frontmatter', problems.join('; '))
      continue
    }
    dirty = true
  }
  if (dirty) {
    const content = assembleAgentDocument(doc, frontmatterText, bodyText)
    if (content !== doc.baseText) {
      const blockIds: BlockId[] = []
      if (frontmatterText !== doc.frontmatterText) blockIds.push('frontmatter')
      if (bodyText !== doc.bodyText) blockIds.push('prose')
      entries.push({ file: doc.path, content, blockIds, baseText: doc.baseText })
    }
  }
  return { entries, rejections }
}

/**
 * Commit a plan: per entry, pre-validate, refuse an overwritten change, then
 * write atomically. Every outcome is a result row; this never throws.
 */
export async function commitPlan(plan: WritePlan, fileSystem: ControlFileSystem): Promise<WriteReport> {
  const results: WriteResult[] = []
  for (const entry of plan.entries) {
    results.push(await commitEntry(entry, fileSystem))
  }
  return { results }
}

/** Commit one planned file. */
async function commitEntry(entry: WritePlanEntry, fileSystem: ControlFileSystem): Promise<WriteResult> {
  // Defensive re-validation: the plan is pure data and may have travelled.
  const problems = parseAgentDocument(entry.content).frontmatter.problems
  if (problems.length > 0) {
    return { ok: false, file: entry.file, code: 'invalid-content', message: problems.join('; ') }
  }
  try {
    const diskText = await fileSystem.readTextFile(entry.file)
    if (diskText === undefined) {
      return { ok: false, file: entry.file, code: 'not-found', message: `file disappeared since it was composed: ${entry.file}` }
    }
    if (diskText !== entry.baseText && diskText !== entry.content) {
      return { ok: false, file: entry.file, code: 'conflict', message: `file changed on disk since it was composed: ${entry.file}` }
    }
  } catch (error) {
    return { ok: false, file: entry.file, code: 'io-error', message: errorMessage(error) }
  }
  return await atomicWriteFile(entry.file, entry.content, fileSystem)
}

/**
 * Atomic replace: create a temp file in the target directory, rename it over
 * the target, then re-read to confirm. The temp file is cleaned up when the
 * write fails partway.
 */
export async function atomicWriteFile(file: string, content: string, fileSystem: ControlFileSystem): Promise<WriteResult> {
  const directory = dirname(file)
  let tempPath: string | undefined
  try {
    await fileSystem.ensureDirectory(directory)
    tempPath = await fileSystem.writeNewFile(directory, content, 0o600)
    await fileSystem.renameFile(tempPath, file)
  } catch (error) {
    if (tempPath !== undefined) await fileSystem.removeFile(tempPath).catch(() => {})
    return { ok: false, file, code: 'io-error', message: errorMessage(error) }
  }
  let written: string | undefined
  try {
    written = await fileSystem.readTextFile(file)
  } catch (error) {
    return { ok: false, file, code: 'io-error', message: errorMessage(error) }
  }
  if (written !== content) {
    return { ok: false, file, code: 'io-error', message: `post-write verification failed: ${file}` }
  }
  return { ok: true, file }
}
