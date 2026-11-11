/**
 * The single client-side registry write channel (ticket 62).
 *
 * Every registry mutation the panel performs goes through this module: it
 * wraps the control client's `applyRegistryEdit` (one POST per edit), turns
 * each host report or wire failure into one UI-vocabulary row, and triggers
 * exactly one post-write read-back after a batch with at least one success.
 *
 * The writer owns no transport of its own and never calls `/invalidate`:
 * `/agent-atelier/registry` already invalidates the host registry, so the only
 * thing left after a write is the page's snapshot reload (a plain
 * `GET /agent-atelier/state`). One writer instance allows one batch in flight;
 * a second submission is answered with `busy` and sends nothing.
 *
 * React-free and chunk-free: the lazy registry views receive the page's
 * `onRegistryWrite` callback through `chunk-contracts`, never this module.
 */
import { ControlClientError, errorMessage, isAbortError, throwIfAborted } from '../../control/client-errors.ts'

import type { ControlSnapshot, RegistryEdit, WriteReport, WriteResult } from '../../control/index.ts'
import type { RegistryWriteFailureCode, RegistryWriteOutcome, RegistryWriteRow } from './chunk-contracts.ts'

/** One batch's scope and cancellation. */
export interface RegistryWriteCallOptions {
  /** Workspace whose project layer the edits target; absent means user-global. */
  readonly cwd?: string | undefined
  /** Cancels the whole batch, including its post-write read-back. */
  readonly signal: AbortSignal
}

/** The two effects the writer composes; the page supplies both. */
export interface RegistryWriteDependencies {
  applyRegistryEdit(
    edit: RegistryEdit,
    options: { readonly cwd?: string | undefined; readonly signal?: AbortSignal | undefined },
  ): Promise<WriteReport>
  /**
   * The one post-write read-back. Must be snapshot-only (no `/invalidate`);
   * the page binds it to the invalidate:false branch of its single reload.
   */
  reloadAfterWrite(options: {
    readonly cwd?: string | undefined
    readonly signal: AbortSignal
  }): Promise<ControlSnapshot>
}

/** One writer instance is one write channel with one in-flight batch. */
export interface RegistryWriter {
  /** Run edits serially; write failures become outcome rows, abort rejects. */
  run(edits: readonly RegistryEdit[], options: RegistryWriteCallOptions): Promise<RegistryWriteOutcome>
  /** Whether a batch is currently in flight (the page mirrors this for its busy prop). */
  isBusy(): boolean
}

/** A second submission's answer: the writer sent nothing. */
export const REGISTRY_WRITE_BUSY: RegistryWriteOutcome = {
  status: 'busy',
  rows: [],
  changedCount: 0,
}

/** Create the registry write channel over the control client and the page reload. */
export function createRegistryWriter(dependencies: RegistryWriteDependencies): RegistryWriter {
  let inFlight = false

  return {
    isBusy: () => inFlight,
    async run(edits, options) {
      if (inFlight) return REGISTRY_WRITE_BUSY

      inFlight = true
      try {
        throwIfAborted(options.signal)
        if (edits.length === 0) return { status: 'ok', rows: [], changedCount: 0 }

        const rows: RegistryWriteRow[] = []
        let changedCount = 0
        for (const [editIndex, edit] of edits.entries()) {
          throwIfAborted(options.signal)
          const editRows = await applyOne(dependencies, edit, editIndex, options)
          rows.push(...editRows)
          changedCount += editRows.filter((row) => row.ok).length
        }

        if (changedCount === 0) return { status: 'failed', rows, changedCount: 0 }
        throwIfAborted(options.signal)
        return await reloadAndCollect(dependencies, rows, changedCount, changedCount === rows.length, options)
      } finally {
        inFlight = false
      }
    },
  }
}

/** One edit's raw report or failure, mapped into zero or more UI rows. */
async function applyOne(
  dependencies: RegistryWriteDependencies,
  edit: RegistryEdit,
  editIndex: number,
  options: RegistryWriteCallOptions,
): Promise<readonly RegistryWriteRow[]> {
  try {
    const report = await dependencies.applyRegistryEdit(edit, {
      cwd: options.cwd,
      signal: options.signal,
    })
    return rowsFromReport(report, editIndex)
  } catch (error) {
    if (isAbortError(error)) throw error
    return rowsFromError(error, editIndex)
  }
}

/** The one post-write read-back; a failure is data, an abort is not. */
async function reloadAndCollect(
  dependencies: RegistryWriteDependencies,
  rows: readonly RegistryWriteRow[],
  changedCount: number,
  allEditsSucceeded: boolean,
  options: RegistryWriteCallOptions,
): Promise<RegistryWriteOutcome> {
  const status = allEditsSucceeded ? 'ok' : 'partial'
  try {
    const snapshot = await dependencies.reloadAfterWrite({
      cwd: options.cwd,
      signal: options.signal,
    })
    return { status, rows, changedCount, snapshot }
  } catch (error) {
    if (isAbortError(error)) throw error
    return { status, rows, changedCount, reloadError: errorMessage(error) }
  }
}

/**
 * Map a 200 report. The registry route returns one row per edit; a zero-row
 * report is a protocol breach, so it stays zero rows (no fabricated result).
 */
function rowsFromReport(report: WriteReport, editIndex: number): readonly RegistryWriteRow[] {
  return report.results.map((result) => rowFromResult(result, editIndex))
}

/**
 * A non-2xx. 409 and 5xx keep the exact report rows (the only statuses whose
 * rows the spec trusts); every other status is pinned by the envelope mapping,
 * so a hostile or drifted report row cannot bypass 400/403/404/413/415.
 */
function rowsFromError(error: unknown, editIndex: number): readonly RegistryWriteRow[] {
  if (error instanceof ControlClientError) {
    if (error.status === 409 || error.status >= 500) {
      const failures = reportFailures(error.report, editIndex)
      if (failures.length > 0) return failures
    }
    return [{
      ok: false,
      editIndex,
      file: undefined,
      code: codeForStatus(error.status),
      message: error.message,
    }]
  }
  return [{
    ok: false,
    editIndex,
    file: undefined,
    code: 'network',
    message: errorMessage(error),
  }]
}

/** Only failed report rows survive a non-2xx; a non-2xx cannot have written ok rows. */
function reportFailures(report: WriteReport | undefined, editIndex: number): readonly RegistryWriteRow[] {
  if (report === undefined) return []
  return report.results
    .map((result) => rowFromResult(result, editIndex))
    .filter((row) => !row.ok)
}

function rowFromResult(result: WriteResult, editIndex: number): RegistryWriteRow {
  if (result.ok) return { ok: true, editIndex, file: result.file }
  return { ok: false, editIndex, file: result.file, code: result.code, message: result.message }
}

/**
 * The only status-to-code fallback the UI vocabulary has. 400 is the request
 * envelope (never a report row), 403/413/415 are protocol misuse a first-party
 * client cannot produce; all three mean "the edit was refused before landing".
 */
function codeForStatus(status: number): RegistryWriteFailureCode {
  switch (status) {
    case 404:
      return 'not-found'
    case 409:
      return 'conflict'
    case 400:
    case 403:
    case 413:
    case 415:
      return 'invalid-edit'
    default:
      return 'io-error'
  }
}
