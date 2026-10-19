/**
 * The agent-atelier wire contract (ticket 12): request validation, the six
 * exact routes, per-edit rejection semantics, and the status mapping. The
 * handler only validates the envelope → calls the ticket-11 control core →
 * serializes the result; no domain rule is re-implemented here.
 *
 * Frozen shapes:
 *   GET  /agent-atelier/state?cwd=…        → { cwd, scanId, snapshot }
 *   POST /agent-atelier/compose {agentName}→ { cwd, document }
 *   POST /agent-atelier/plan {edits[]}     → { cwd, plan } (rejections are data)
 *   POST /agent-atelier/commit {edits[]}   → { cwd, report } | 400 {error, rejections}
 *   POST /agent-atelier/registry {edit}    → { cwd, report }
 *   POST /agent-atelier/invalidate         → { ok: true, scanId }
 *
 * Every mutation requires `content-type: application/json` and the
 * `x-dsh-agent-atelier: 1` marker header; the transport also applies the
 * host connection's origin/host fence before dispatch.
 */
import { Buffer } from 'node:buffer'
import { isAbsolute } from 'node:path'

import { planDirtyEdits, statusForWriteReport, throwIfAborted } from '../../control/index.ts'

import type { ControlCore, DocumentEdit, FrontmatterField, RegistryEdit, WriteReport } from '../../control/index.ts'

/** Root of the plugin's exact route namespace. */
export const CONTROL_BASE_PATH = '/agent-atelier'

/** Exact paths registered on `ctx.webServer`; one route per operation. */
export const CONTROL_ROUTE_PATHS = [
  `${CONTROL_BASE_PATH}/state`,
  `${CONTROL_BASE_PATH}/compose`,
  `${CONTROL_BASE_PATH}/plan`,
  `${CONTROL_BASE_PATH}/commit`,
  `${CONTROL_BASE_PATH}/registry`,
  `${CONTROL_BASE_PATH}/invalidate`,
] as const

/** Largest JSON request body accepted (bytes). */
export const MAX_BODY_BYTES = 1024 * 1024
/** Largest number of document edits accepted in one plan/commit request. */
export const MAX_EDITS = 200
/** Largest agent name accepted. */
export const MAX_AGENT_NAME_LENGTH = 128
/** Largest raw text value (block / system prompt) accepted. */
export const MAX_TEXT_LENGTH = 512 * 1024
/** Largest single field value accepted in a field edit. */
export const MAX_FIELD_VALUE_LENGTH = 64 * 1024
/** Largest number of entries accepted in one list-valued field edit. */
export const MAX_FIELD_ITEMS = 64
/** Largest cwd accepted. */
export const MAX_CWD_LENGTH = 4096
/** Mutation marker header; browser clients must send it (CSRF defence in depth). */
export const CLIENT_MARKER_HEADER = 'x-dsh-agent-atelier'
/** The only accepted marker value. */
export const CLIENT_MARKER_VALUE = '1'

const FRONTMATTER_FIELDS: readonly FrontmatterField[] = [
  'name',
  'description',
  'color',
  'emoji',
  'spawn',
  'reasoningEffort',
  'modelOrder',
  'requiredTools',
  'skills',
]

type RouteName = 'state' | 'compose' | 'plan' | 'commit' | 'registry' | 'invalidate'

const ROUTES: Readonly<Record<string, { readonly name: RouteName; readonly methods: readonly string[] }>> = {
  [`${CONTROL_BASE_PATH}/state`]: { name: 'state', methods: ['GET'] },
  [`${CONTROL_BASE_PATH}/compose`]: { name: 'compose', methods: ['POST'] },
  [`${CONTROL_BASE_PATH}/plan`]: { name: 'plan', methods: ['POST'] },
  [`${CONTROL_BASE_PATH}/commit`]: { name: 'commit', methods: ['POST'] },
  [`${CONTROL_BASE_PATH}/registry`]: { name: 'registry', methods: ['POST'] },
  [`${CONTROL_BASE_PATH}/invalidate`]: { name: 'invalidate', methods: ['POST'] },
}

/** Everything the route handler hands the pure dispatcher. */
export interface ControlDispatchInput {
  readonly control: ControlCore
  readonly method: string
  readonly pathname: string
  readonly search: URLSearchParams
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly bodyText: string | null
  readonly signal?: AbortSignal | undefined
  /** Monotonic per-route scan token, echoed to the client to reject stale reads. */
  readonly scanId: number
}

/** Status + JSON body the transport writes; the dispatcher never touches `res`. */
export interface ControlDispatchResult {
  readonly status: number
  readonly body: unknown
}

/** Validate, dispatch, and serialize one request; never throws for request errors. */
export async function dispatchControlRequest(input: ControlDispatchInput): Promise<ControlDispatchResult> {
  const route = ROUTES[input.pathname]
  if (route === undefined) return fail(404, 'not-found', `unknown route: ${input.pathname}`)
  if (!route.methods.includes(input.method)) {
    return fail(405, 'method-not-allowed', `method ${input.method} is not allowed on ${input.pathname}`)
  }

  const readOnly = route.name === 'state'
  if (!readOnly) {
    if (header(input.headers, CLIENT_MARKER_HEADER) !== CLIENT_MARKER_VALUE) {
      return fail(403, 'forbidden', `mutation requests must carry ${CLIENT_MARKER_HEADER}: ${CLIENT_MARKER_VALUE}`)
    }
    const contentType = header(input.headers, 'content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return fail(415, 'unsupported-media-type', 'request body must be application/json')
    }
    if (input.bodyText === null) return fail(400, 'invalid-request', 'request body is required')
    if (Buffer.byteLength(input.bodyText, 'utf8') > MAX_BODY_BYTES) {
      return fail(413, 'payload-too-large', `request body exceeds ${MAX_BODY_BYTES} bytes`)
    }
  }

  try {
    throwIfAborted(input.signal)
    switch (route.name) {
      case 'state':
        return await handleState(input)
      case 'compose':
        return await handleCompose(input)
      case 'plan':
        return await handlePlan(input)
      case 'commit':
        return await handleCommit(input)
      case 'registry':
        return await handleRegistry(input)
      case 'invalidate':
        input.control.invalidate()
        return { status: 200, body: { ok: true, scanId: input.scanId } }
    }
  } catch (error) {
    if (isAbortError(error)) return fail(499, 'aborted', 'request cancelled')
    return fail(500, 'internal', error instanceof Error ? error.message : String(error))
  }
}

/** `GET /state`: snapshot the workspace, echo cwd and scan token. */
async function handleState(input: ControlDispatchInput): Promise<ControlDispatchResult> {
  const cwd = readCwdFromSearch(input.search)
  if (!cwd.ok) return fail(400, 'invalid-request', cwd.message)
  const resolved = cwd.value ?? process.cwd()
  const snapshot = await input.control.snapshot({ cwd: resolved })
  return { status: 200, body: { cwd: resolved, scanId: input.scanId, snapshot } }
}

/** `POST /compose`: one agent document; unknown agent is 404. */
async function handleCompose(input: ControlDispatchInput): Promise<ControlDispatchResult> {
  const parsed = parseJsonObject(input.bodyText)
  if (!parsed.ok) return fail(400, 'invalid-request', parsed.message)
  const agentName = readAgentName(parsed.value.agentName)
  if (!agentName.ok) return fail(400, 'invalid-request', agentName.message)
  const cwd = readCwdValue(parsed.value.cwd)
  if (!cwd.ok) return fail(400, 'invalid-request', cwd.message)
  const resolved = cwd.value ?? process.cwd()
  try {
    const document = await input.control.compose(agentName.value, { cwd: resolved })
    return { status: 200, body: { cwd: resolved, document } }
  } catch (error) {
    if (isUnknownAgent(error)) return fail(404, 'not-found', messageOf(error))
    throw error
  }
}

/** `POST /plan`: preview; per-edit rejections travel as data, nothing is written. */
async function handlePlan(input: ControlDispatchInput): Promise<ControlDispatchResult> {
  const parsed = parseJsonObject(input.bodyText)
  if (!parsed.ok) return fail(400, 'invalid-request', parsed.message)
  const edits = readEdits(parsed.value.edits)
  if (!edits.ok) return fail(400, 'invalid-request', edits.message)
  const cwd = readCwdValue(parsed.value.cwd)
  if (!cwd.ok) return fail(400, 'invalid-request', cwd.message)
  const resolved = cwd.value ?? process.cwd()
  const plan = await planDirtyEdits(input.control, edits.value, { cwd: resolved })
  return { status: 200, body: { cwd: resolved, plan } }
}

/** `POST /commit`: a plan that refuses any edit is a 400 and writes nothing. */
async function handleCommit(input: ControlDispatchInput): Promise<ControlDispatchResult> {
  const parsed = parseJsonObject(input.bodyText)
  if (!parsed.ok) return fail(400, 'invalid-request', parsed.message)
  const edits = readEdits(parsed.value.edits)
  if (!edits.ok) return fail(400, 'invalid-request', edits.message)
  const cwd = readCwdValue(parsed.value.cwd)
  if (!cwd.ok) return fail(400, 'invalid-request', cwd.message)
  const resolved = cwd.value ?? process.cwd()
  const plan = await planDirtyEdits(input.control, edits.value, { cwd: resolved })
  if (plan.rejections.length > 0) {
    const first = plan.rejections[0]
    return {
      status: 400,
      body: { cwd: resolved, error: { code: 'edit-rejected', message: first?.message ?? 'edit rejected' }, rejections: plan.rejections },
    }
  }
  const report = await input.control.commit(plan)
  return reportResult(resolved, report)
}

/** `POST /registry`: one registry edit; each kind lands in one layer file. */
async function handleRegistry(input: ControlDispatchInput): Promise<ControlDispatchResult> {
  const parsed = parseJsonObject(input.bodyText)
  if (!parsed.ok) return fail(400, 'invalid-request', parsed.message)
  const edit = readRegistryEdit(parsed.value.edit)
  if (!edit.ok) return fail(400, 'invalid-request', edit.message)
  const cwd = readCwdValue(parsed.value.cwd)
  if (!cwd.ok) return fail(400, 'invalid-request', cwd.message)
  const resolved = cwd.value ?? process.cwd()
  const report = await input.control.applyRegistryEdit(edit.value)
  return reportResult(resolved, report)
}

/** Map a write report onto the frozen status set, keeping the report in the body. */
function reportResult(cwd: string, report: WriteReport): ControlDispatchResult {
  const status = statusForWriteReport(report)
  if (status === 200) return { status, body: { cwd, report } }
  const failure = report.results.find((result) => !result.ok)
  const message = failure !== undefined && !failure.ok ? failure.message : 'write failed'
  const code = status === 404 ? 'not-found' : status === 409 ? 'conflict' : 'internal'
  return { status, body: { cwd, error: { code, message }, report } }
}

/** One dispatched error body: `{ error: { code, message }, …details }`. */
function fail(status: number, code: string, message: string, extra: Readonly<Record<string, unknown>> = {}): ControlDispatchResult {
  return { status, body: { error: { code, message }, ...extra } }
}

function header(headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value[0]
  }
  return undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isUnknownAgent(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('unknown agent')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

function parseJsonObject(text: string | null): ReadResult<Record<string, unknown>> {
  if (text === null || text.trim().length === 0) return { ok: false, message: 'request body is required' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, message: 'request body is not valid JSON' }
  }
  if (!isRecord(value)) return { ok: false, message: 'request body must be a JSON object' }
  return { ok: true, value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, field: string, max: number): ReadResult<string> {
  if (typeof value !== 'string') return { ok: false, message: `${field} must be a string` }
  if (value.length > max) return { ok: false, message: `${field} exceeds ${max} characters` }
  if (value.includes('\0')) return { ok: false, message: `${field} must not contain NUL` }
  return { ok: true, value }
}

function readAgentName(value: unknown): ReadResult<string> {
  const read = readString(value, 'agentName', MAX_AGENT_NAME_LENGTH)
  if (!read.ok) return read
  if (read.value.length === 0) return { ok: false, message: 'agentName must not be empty' }
  if (read.value === '.' || read.value === '..') return { ok: false, message: 'agentName is not a valid directory name' }
  if (/[\\/]/u.test(read.value)) return { ok: false, message: 'agentName must not contain path separators' }
  return read
}

function readCwdFromSearch(search: URLSearchParams): ReadResult<string | undefined> {
  const values = search.getAll('cwd')
  if (values.length > 1) return { ok: false, message: 'cwd must be given at most once' }
  return readCwdValue(values[0])
}

function readCwdValue(value: unknown): ReadResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== 'string') return { ok: false, message: 'cwd must be a string' }
  if (value.length === 0) return { ok: false, message: 'cwd must not be empty' }
  if (value.length > MAX_CWD_LENGTH) return { ok: false, message: `cwd exceeds ${MAX_CWD_LENGTH} characters` }
  if (value.includes('\0')) return { ok: false, message: 'cwd must not contain NUL' }
  if (!isAbsolute(value)) return { ok: false, message: 'cwd must be an absolute path' }
  return { ok: true, value }
}

function readEdits(value: unknown): ReadResult<DocumentEdit[]> {
  if (!Array.isArray(value)) return { ok: false, message: 'edits must be an array' }
  if (value.length > MAX_EDITS) return { ok: false, message: `edits exceeds ${MAX_EDITS} entries` }
  const edits: DocumentEdit[] = []
  for (const [index, raw] of value.entries()) {
    const edit = readEdit(raw)
    if (!edit.ok) return { ok: false, message: `edits[${index}]: ${edit.message}` }
    edits.push(edit.value)
  }
  return { ok: true, value: edits }
}

function readEdit(value: unknown): ReadResult<DocumentEdit> {
  if (!isRecord(value)) return { ok: false, message: 'edit must be an object' }
  const agentName = readAgentName(value.agentName)
  if (!agentName.ok) return agentName
  if (value.kind === 'setBlockText') {
    if (value.blockId !== 'frontmatter' && value.blockId !== 'prose') {
      return { ok: false, message: 'blockId must be "frontmatter" or "prose"' }
    }
    const text = readString(value.text, 'text', MAX_TEXT_LENGTH)
    if (!text.ok) return text
    return { ok: true, value: { kind: 'setBlockText', agentName: agentName.value, blockId: value.blockId, text: text.value } }
  }
  if (value.kind === 'setFrontmatterField') {
    const field = value.field
    if (typeof field !== 'string' || !(FRONTMATTER_FIELDS as readonly string[]).includes(field)) {
      return { ok: false, message: `field must be one of ${FRONTMATTER_FIELDS.join(', ')}` }
    }
    const fieldValue = readFieldValue(value.value)
    if (!fieldValue.ok) return fieldValue
    return {
      ok: true,
      value: { kind: 'setFrontmatterField', agentName: agentName.value, field: field as FrontmatterField, value: fieldValue.value },
    }
  }
  return { ok: false, message: 'kind must be "setBlockText" or "setFrontmatterField"' }
}

function readFieldValue(value: unknown): ReadResult<string | readonly string[] | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value === 'string') {
    if (value.length > MAX_FIELD_VALUE_LENGTH) return { ok: false, message: `field value exceeds ${MAX_FIELD_VALUE_LENGTH} characters` }
    return { ok: true, value }
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_FIELD_ITEMS) return { ok: false, message: `field value exceeds ${MAX_FIELD_ITEMS} items` }
    const items: string[] = []
    for (const item of value) {
      if (typeof item !== 'string') return { ok: false, message: 'field array items must be strings' }
      if (item.length > MAX_FIELD_VALUE_LENGTH) return { ok: false, message: `field item exceeds ${MAX_FIELD_VALUE_LENGTH} characters` }
      items.push(item)
    }
    return { ok: true, value: items }
  }
  return { ok: false, message: 'field value must be a string, an array of strings, or undefined' }
}

function readRegistryEdit(value: unknown): ReadResult<RegistryEdit> {
  if (!isRecord(value)) return { ok: false, message: 'edit must be an object' }
  const kind = value.kind
  if (kind === 'setAvailable') {
    const modelName = readRegistryName(value.modelName, 'modelName')
    if (!modelName.ok) return modelName
    if (typeof value.available !== 'boolean') return { ok: false, message: 'available must be a boolean' }
    return { ok: true, value: { kind, modelName: modelName.value, available: value.available } }
  }
  if (kind === 'setSysPrompt') {
    const modelName = readRegistryName(value.modelName, 'modelName')
    if (!modelName.ok) return modelName
    const sysPrompt = readOptionalText(value.sysPrompt, 'sysPrompt')
    if (!sysPrompt.ok) return sysPrompt
    return { ok: true, value: { kind, modelName: modelName.value, sysPrompt: sysPrompt.value } }
  }
  if (kind === 'remapAlias') {
    const alias = readRegistryName(value.alias, 'alias')
    if (!alias.ok) return alias
    const target = readRegistryName(value.target, 'target')
    if (!target.ok) return target
    return { ok: true, value: { kind, alias: alias.value, target: target.value } }
  }
  if (kind === 'deleteAlias') {
    const alias = readRegistryName(value.alias, 'alias')
    if (!alias.ok) return alias
    return { ok: true, value: { kind, alias: alias.value } }
  }
  if (kind === 'deleteModel') {
    const modelName = readRegistryName(value.modelName, 'modelName')
    if (!modelName.ok) return modelName
    return { ok: true, value: { kind, modelName: modelName.value } }
  }
  if (kind === 'addAlias') {
    const alias = readRegistryName(value.alias, 'alias')
    if (!alias.ok) return alias
    const target = readRegistryName(value.target, 'target')
    if (!target.ok) return target
    const source = readLayerSource(value.source)
    if (!source.ok) return source
    return { ok: true, value: { kind, alias: alias.value, target: target.value, source: source.value } }
  }
  if (kind === 'addModel') {
    const modelName = readRegistryName(value.modelName, 'modelName')
    if (!modelName.ok) return modelName
    const provider = readString(value.provider, 'provider', 256)
    if (!provider.ok) return provider
    const model = readString(value.model, 'model', 256)
    if (!model.ok) return model
    const sysPrompt = readOptionalText(value.sysPrompt, 'sysPrompt')
    if (!sysPrompt.ok) return sysPrompt
    if (value.available !== undefined && value.available !== null && typeof value.available !== 'boolean') {
      return { ok: false, message: 'available must be a boolean when given' }
    }
    const source = readLayerSource(value.source)
    if (!source.ok) return source
    return {
      ok: true,
      value: {
        kind,
        modelName: modelName.value,
        provider: provider.value,
        model: model.value,
        sysPrompt: sysPrompt.value,
        available: typeof value.available === 'boolean' ? value.available : undefined,
        source: source.value,
      },
    }
  }
  return { ok: false, message: 'unknown registry edit kind' }
}

function readRegistryName(value: unknown, field: string): ReadResult<string> {
  const read = readString(value, field, MAX_AGENT_NAME_LENGTH)
  if (!read.ok) return read
  if (!/^[A-Za-z0-9_.-]+$/u.test(read.value)) {
    return { ok: false, message: `${field} may only contain letters, digits, "_", "." and "-"` }
  }
  return read
}

function readOptionalText(value: unknown, field: string): ReadResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  const read = readString(value, field, MAX_TEXT_LENGTH)
  if (!read.ok) return read
  return { ok: true, value: read.value }
}

function readLayerSource(value: unknown): ReadResult<'project-dsh' | 'user-dsh'> {
  if (value === 'project-dsh' || value === 'user-dsh') return { ok: true, value }
  return { ok: false, message: 'source must be "project-dsh" or "user-dsh"' }
}
