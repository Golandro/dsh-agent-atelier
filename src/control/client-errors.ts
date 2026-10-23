/**
 * Wire-facing control client contract — errors, status helpers, and the
 * mutation marker header — browser-safe by construction: no `node:*` import
 * and no runtime dependency outside this package, so the browser bundle can
 * share the exact class the in-memory adapter throws and the exact marker
 * value the host wire enforces.
 */
import type { WriteRejection, WriteReport, WriteResult } from './types.ts'

/** Mutation marker header; browser clients must send it (CSRF defence in depth). */
export const CLIENT_MARKER_HEADER = 'x-dsh-agent-atelier'

/** The only accepted marker value. */
export const CLIENT_MARKER_VALUE = '1'

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

/** Thrown when a compose names an agent no discovery root knows; both adapters map it to 404/`not-found`. */
export class UnknownAgentError extends Error {
  constructor(agentName: string) {
    super(`unknown agent: "${agentName}"`)
    this.name = 'UnknownAgentError'
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

/** Whether a thrown value is the abort both browser `fetch` and the memory adapter raise. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** One-line message of an unknown thrown value, for result rows that never throw. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const message = errorMessage(error)
  const unknown = error instanceof UnknownAgentError
  return new ControlClientError(unknown ? 404 : 500, unknown ? 'not-found' : 'internal', message)
}
