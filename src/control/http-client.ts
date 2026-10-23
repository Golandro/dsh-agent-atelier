/**
 * The HTTP adapter of the control client port (ticket 12) — Node-free, so both
 * the browser bundle and the adapter contract suite in `test/` can use it.
 *
 * It speaks the frozen wire contract in `src/dsh/host/wire.ts`: document-relative
 * URLs (Desktop forwards the same path), a JSON marker header on mutations
 * (the one shared definition in `./client-errors.ts`), the caller's
 * `AbortSignal` all the way to `fetch`, and non-2xx bodies mapped onto
 * {@link ControlClientError}.
 */
import { abortError, CLIENT_MARKER_HEADER, CLIENT_MARKER_VALUE, ControlClientError } from './client-errors.ts'

import type { ControlClient, ControlClientOptions } from './client.ts'
import type {
  ComposedAgentDocument,
  ControlSnapshot,
  DocumentEdit,
  RegistryEdit,
  WritePlan,
  WriteRejection,
  WriteReport,
} from './types.ts'

/** Route namespace registered by `src/dsh/host/ui-host.ts`. */
const DEFAULT_BASE_URL = 'agent-atelier'

/** Construction options of the HTTP control client. */
export interface HttpControlClientOptions {
  /** Route root; document-relative by default so Desktop and sub-path shells agree. */
  readonly baseUrl?: string | undefined
  /** Workspace root sent with every call; the host default applies when omitted. */
  readonly cwd?: string | undefined
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch | undefined
  /** Extra headers, mostly for tests. */
  readonly headers?: Readonly<Record<string, string>> | undefined
}

type JsonRecord = Record<string, unknown>

/** The HTTP adapter: one `ControlClient` over the six exact routes. */
export function createHttpControlClient(options: HttpControlClientOptions = {}): ControlClient {
  const baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  async function request(
    endpoint: string,
    method: 'GET' | 'POST',
    payload: JsonRecord | undefined,
    call: ControlClientOptions | undefined,
  ): Promise<JsonRecord> {
    const signal = call?.signal
    if (isAborted(signal)) throw abortError()
    const cwd = call?.cwd ?? options.cwd
    const url = method === 'GET' && cwd !== undefined
      ? `${baseUrl}/${endpoint}?${new URLSearchParams({ cwd }).toString()}`
      : `${baseUrl}/${endpoint}`
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers }
    if (method === 'POST') {
      headers['content-type'] = 'application/json'
      headers[CLIENT_MARKER_HEADER] = CLIENT_MARKER_VALUE
    }
    const body = method === 'POST'
      ? JSON.stringify(cwd === undefined ? payload ?? {} : { ...payload, cwd })
      : undefined
    let response: Response
    try {
      response = await fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body }), ...(signal === undefined ? {} : { signal }) })
    } catch (error) {
      if (isAborted(signal)) throw abortError()
      throw error
    }
    const text = await response.text()
    if (isAborted(signal)) throw abortError()
    let parsed: unknown
    if (text.length === 0) parsed = {}
    else {
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new ControlClientError(response.status, 'internal', 'control route returned invalid JSON')
      }
    }
    if (!isRecord(parsed)) throw new ControlClientError(response.status, 'internal', 'control route returned a non-object body')
    if (!response.ok) throw errorFromBody(response.status, parsed)
    return parsed
  }

  return {
    async snapshot(call) {
      const body = await request('state', 'GET', undefined, call)
      return readField<ControlSnapshot>(body, 'snapshot', 'snapshot')
    },

    async compose(agentName, call) {
      const body = await request('compose', 'POST', { agentName }, call)
      return readField<ComposedAgentDocument>(body, 'document', 'document')
    },

    async plan(agentName, edits: readonly DocumentEdit[], call) {
      const body = await request('plan', 'POST', { agentName, edits }, call)
      return readField<WritePlan>(body, 'plan', 'plan')
    },

    async commit(edits: readonly DocumentEdit[], call) {
      const body = await request('commit', 'POST', { edits }, call)
      return readField<WriteReport>(body, 'report', 'report')
    },

    async applyRegistryEdit(edit: RegistryEdit, call) {
      const body = await request('registry', 'POST', { edit }, call)
      return readField<WriteReport>(body, 'report', 'report')
    },

    async invalidate(call) {
      await request('invalidate', 'POST', {}, call)
    },
  }
}

/** Read the abort flag through a call, so TS does not narrow the object state. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readField<T>(body: JsonRecord, field: string, label: string): T {
  const value = body[field]
  if (value === undefined) throw new ControlClientError(500, 'internal', `control route response is missing "${label}"`)
  return value as T
}

/** Map a non-2xx wire body onto the shared client error. */
function errorFromBody(status: number, body: JsonRecord): ControlClientError {
  const error = isRecord(body.error) ? body.error : {}
  const code = typeof error.code === 'string' ? error.code : defaultCode(status)
  const message = typeof error.message === 'string' ? error.message : `control route failed with HTTP ${status}`
  const rejections = Array.isArray(body.rejections) ? (body.rejections as readonly WriteRejection[]) : undefined
  const report = isRecord(body.report) ? (body.report as unknown as WriteReport) : undefined
  return new ControlClientError(status, code, message, { rejections, report })
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'invalid-request'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 409:
      return 'conflict'
    case 413:
      return 'payload-too-large'
    case 415:
      return 'unsupported-media-type'
    case 499:
      return 'aborted'
    default:
      return 'internal'
  }
}
