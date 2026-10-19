/**
 * Wire-facing control client errors and status helpers — browser-safe by
 * construction: no `node:*` import and no runtime dependency outside this
 * package, so the browser bundle can share the exact class the in-memory
 * adapter throws.
 */
import type { WriteRejection, WriteReport, WriteResult } from './types.ts'

/** A non-2xx control call, with the wire status and whatever report came with it. */
export class ControlClientError extends Error {
  readonly status: number
  readonly code: string
  readonly rejections: readonly WriteRejection[] | undefined
  readonly report: WriteReport | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { readonly rejections?: readonly WriteRejection[] | undefined; readonly report?: WriteReport | undefined } = {},
  ) {
    super(message)
    this.name = 'ControlClientError'
    this.status = status
    this.code = code
    this.rejections = extra.rejections
    this.report = extra.report
  }
}

/** An abort that both browser `fetch` and the memory adapter can raise. */
export function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/** Throw the shared abort error when the caller already cancelled. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError()
}

/** The HTTP status a write report maps to; shared by both adapters. */
export function statusForWriteReport(report: WriteReport): 200 | 404 | 409 | 500 {
  for (const result of report.results) {
    if (result.ok) continue
    switch (result.code) {
      case 'conflict':
      case 'read-only':
        return 409
      case 'not-found':
        return 404
      case 'invalid-content':
      case 'invalid-edit':
      case 'io-error':
        return 500
    }
  }
  return 200
}

/** The code a non-2xx write report carries on the client error. */
export function codeForReport(report: WriteReport): string {
  const status = statusForWriteReport(report)
  if (status === 404) return 'not-found'
  if (status === 409) {
    const conflict = report.results.some((result) => !result.ok && result.code === 'conflict')
    return conflict ? 'conflict' : 'read-only'
  }
  return 'internal'
}

/** Throw the failure row of a report as the wire-shaped client error. */
export function reportOrThrow(report: WriteReport): WriteReport {
  let failure: Extract<WriteResult, { ok: false }> | undefined
  for (const result of report.results) {
    if (!result.ok) {
      failure = result
      break
    }
  }
  if (failure === undefined) return report
  throw new ControlClientError(statusForWriteReport(report), codeForReport(report), failure.message, { report })
}

/** Map a compose failure onto the wire-shaped error the HTTP adapter produces. */
export function composeError(error: unknown): ControlClientError {
  const message = error instanceof Error ? error.message : String(error)
  const unknown = message.startsWith('unknown agent')
  return new ControlClientError(unknown ? 404 : 500, unknown ? 'not-found' : 'internal', message)
}
