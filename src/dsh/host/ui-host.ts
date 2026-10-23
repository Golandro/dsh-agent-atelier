/**
 * The host side of ticket 12: one plugin row owns the six exact routes on
 * `ctx.webServer`, applies the host connection's origin/host fence, bounds and
 * parses the request body, and hands the rest to the pure wire dispatcher.
 *
 * `ctx.webServer` deliberately has no authentication, body limit or abort
 * signal of its own (`packages/host/webserver/README.md`), so this module adds
 * the fences the write path needs: `connection.requestRejection` when the host
 * exposes it, a request-size cap, and response-close → AbortController.
 */
import { Buffer } from 'node:buffer'

import { AGENT_CONTROL_SERVICE } from '../../contract/index.ts'
import { errorMessage, isAbortError } from '../../control/index.ts'
import { CONTROL_ROUTE_PATHS, MAX_BODY_BYTES, dispatchControlRequest } from './wire.ts'

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ControlCore } from '../../control/index.ts'

/** The structural slice of `ctx.webServer` this row registers on. */
interface HostWebRoute {
  readonly kind: 'exact'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface HostWebServer {
  register(route: HostWebRoute): () => void
}

/** The structural slice of `ctx.connection` used for the origin/host fence. */
interface HostConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Everything one request handler needs; built once per mounted row. */
interface RouteDependencies {
  readonly control: ControlCore
  readonly connection: HostConnection | undefined
  readonly nextScanId: () => number
}

/**
 * Mount the control routes on this context. The loader row injects `webServer`
 * and `agentControl`; a minimal context without either stays a silent no-op
 * (with one diagnostic) instead of failing activation.
 */
export function applyUiHost(ctx: Context): void {
  const control = ctx.get(AGENT_CONTROL_SERVICE) as ControlCore | undefined
  const webServer = ctx.get('webServer') as HostWebServer | undefined
  if (control === undefined || webServer === undefined) {
    const missing = control === undefined ? AGENT_CONTROL_SERVICE : 'webServer'
    ctx.logger.warn(`agent-atelier ui-host: ${missing} is not available; control routes are not mounted`)
    return
  }
  const connection = optionalConnection(ctx)
  let scanId = 0
  const dependencies: RouteDependencies = {
    control,
    connection,
    nextScanId: () => {
      scanId += 1
      return scanId
    },
  }
  for (const path of CONTROL_ROUTE_PATHS) {
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => handleControlRequest(req, res, dependencies),
      }),
    )
  }
}

/** Transport adapter: fences → bounded body → dispatcher → JSON response. */
export async function handleControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dependencies: RouteDependencies,
): Promise<void> {
  const rejection = dependencies.connection?.requestRejection({ headers: req.headers })
  if (rejection !== undefined) {
    sendJson(res, rejection, {
      error: {
        code: rejection === 401 ? 'unauthorized' : 'forbidden',
        message: rejection === 401 ? 'request is not authenticated' : 'request origin is not trusted',
      },
    })
    return
  }

  const controller = new AbortController()
  const abort = (): void => {
    if (!res.writableEnded) controller.abort()
  }
  res.on('close', abort)
  try {
    const method = (req.method ?? 'GET').toUpperCase()
    const body = method === 'GET' || method === 'HEAD'
      ? { ok: true as const, text: null }
      : await readBody(req, MAX_BODY_BYTES, controller.signal)
    if (!body.ok) {
      sendJson(res, body.status, { error: { code: body.code, message: body.message } })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const result = await dispatchControlRequest({
      control: dependencies.control,
      method,
      pathname: url.pathname,
      search: url.searchParams,
      headers: req.headers,
      bodyText: body.text,
      signal: controller.signal,
      scanId: dependencies.nextScanId(),
    })
    sendJson(res, result.status, result.body)
  } catch (error) {
    if (isAbortError(error)) {
      if (!res.writableEnded) sendJson(res, 499, { error: { code: 'aborted', message: 'request cancelled' } })
    } else if (!res.headersSent) {
      sendJson(res, 500, { error: { code: 'internal', message: errorMessage(error) } })
    } else {
      res.destroy()
    }
  } finally {
    res.off('close', abort)
  }
}

type BodyRead = { readonly ok: true; readonly text: string | null } | {
  readonly ok: false
  readonly status: number
  readonly code: string
  readonly message: string
}

/** Drain a bounded UTF-8 body; an oversized body is refused before buffering. */
async function readBody(req: IncomingMessage, limit: number, signal: AbortSignal): Promise<BodyRead> {
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > limit) return tooLarge(limit)
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    if (signal.aborted) return { ok: false, status: 499, code: 'aborted', message: 'request cancelled' }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > limit) {
      req.destroy()
      return tooLarge(limit)
    }
    chunks.push(buffer)
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') }
}

function tooLarge(limit: number): BodyRead {
  return { ok: false, status: 413, code: 'payload-too-large', message: `request body exceeds ${limit} bytes` }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function optionalConnection(ctx: Context): HostConnection | undefined {
  const candidate: unknown = ctx.get('connection')
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const connection = candidate as Partial<HostConnection>
  return typeof connection.requestRejection === 'function' ? (connection as HostConnection) : undefined
}

/** Exposed for the host-row test; the loader only needs {@link applyUiHost}. */
export type { HostWebServer }
