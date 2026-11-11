import { describe, expect, it } from 'vitest'

import { CLIENT_MARKER_HEADER, CLIENT_MARKER_VALUE, abortError, isAbortError } from '../src/control/client-errors.ts'
import { createHttpControlClient } from '../src/control/http-client.ts'
import { createRegistryWriter } from '../src/dsh/client/registry-writes.ts'

import type { ControlSnapshot, RegistryEdit } from '../src/control/index.ts'
import type { RegistryWriteDependencies } from '../src/dsh/client/registry-writes.ts'

const PROJECT = '/proj'
const REGISTRY = `${PROJECT}/.dsh/agents/registry.yaml`
const JSON_HEADERS = { 'content-type': 'application/json' } as const

const EDIT: RegistryEdit = { kind: 'setAvailable', modelName: 'gpt5', available: false }

const SNAPSHOT: ControlSnapshot = {
  agents: [],
  models: [],
  aliases: [],
  registryLayers: [],
  agentDiagnostics: [],
  aliasDiagnostics: [],
  findings: [],
  assemblies: {},
  scope: { cwd: PROJECT, projectRoot: PROJECT },
}

interface WireReply {
  readonly status: number
  readonly body: unknown
}

type ReloadOptions = Parameters<RegistryWriteDependencies['reloadAfterWrite']>[0]
type ReloadFn = (options: ReloadOptions) => Promise<ControlSnapshot>

interface RecordedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

interface WriterHarness {
  readonly writer: ReturnType<typeof createRegistryWriter>
  readonly reloads: ReloadOptions[]
  readonly fetchCalls: () => number
  readonly requests: RecordedRequest[]
}

const OK_REPLY: WireReply = {
  status: 200,
  body: { cwd: PROJECT, report: { results: [{ ok: true, file: REGISTRY }] } },
}

/** A fetch double returning the queued wire replies in order (the last one repeats). */
function repliesFetch(replies: readonly WireReply[]): typeof fetch {
  let index = 0
  return async () => {
    const reply = replies[Math.min(index, replies.length - 1)]
    index += 1
    if (reply === undefined) throw new Error('no queued reply')
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: JSON_HEADERS })
  }
}

/** The writer over a real HTTP adapter whose fetch is a double. */
function harnessWithFetch(fetchImpl: typeof fetch, reload: ReloadFn = async () => SNAPSHOT): WriterHarness {
  let calls = 0
  const requests: RecordedRequest[] = []
  const countingFetch: typeof fetch = async (input, init) => {
    calls += 1
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    })
    return await fetchImpl(input, init)
  }
  const client = createHttpControlClient({ baseUrl: 'http://host/agent-atelier', fetchImpl: countingFetch, cwd: PROJECT })
  const reloads: ReloadOptions[] = []
  const writer = createRegistryWriter({
    applyRegistryEdit: (edit, options) => client.applyRegistryEdit(edit, options),
    reloadAfterWrite: async (options) => {
      reloads.push(options)
      return await reload(options)
    },
  })
  return { writer, reloads, fetchCalls: () => calls, requests }
}

function harness(replies: readonly WireReply[], reload?: ReloadFn): WriterHarness {
  return harnessWithFetch(repliesFetch(replies), reload)
}

function networkHarness(): WriterHarness {
  return harnessWithFetch(async () => { throw new TypeError('fetch failed') })
}

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('registry writes: single edit', () => {
  it('writes one registry edit, then reloads once with the workspace cwd', async () => {
    const h = harness([OK_REPLY])
    const outcome = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('ok')
    expect(outcome.changedCount).toBe(1)
    expect(outcome.rows).toEqual([{ ok: true, editIndex: 0, file: REGISTRY }])
    expect(outcome.snapshot).toEqual(SNAPSHOT)
    expect(h.reloads).toHaveLength(1)
    expect(h.reloads[0]?.cwd).toBe(PROJECT)
  })

  it('treats an empty batch as a no-op: no request, no reload', async () => {
    const h = harness([OK_REPLY])
    const outcome = await h.writer.run([], { cwd: PROJECT, signal: signal() })

    expect(outcome).toEqual({ status: 'ok', rows: [], changedCount: 0 })
    expect(h.fetchCalls()).toBe(0)
    expect(h.reloads).toHaveLength(0)
  })

  it('does not reload when every result row failed', async () => {
    const h = harness([
      { status: 200, body: { cwd: PROJECT, report: { results: [{ ok: false, file: REGISTRY, code: 'io-error', message: 'disk gone' }] } } },
    ])
    const outcome = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('failed')
    expect(outcome.changedCount).toBe(0)
    expect(outcome.rows[0]).toMatchObject({ ok: false, code: 'io-error', message: 'disk gone' })
    expect(h.reloads).toHaveLength(0)
  })

  it('a 200 report with no rows fails without fabricating a row', async () => {
    const h = harness([{ status: 200, body: { cwd: PROJECT, report: { results: [] } } }])
    const outcome = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('failed')
    expect(outcome.rows).toEqual([])
    expect(outcome.changedCount).toBe(0)
    expect(h.reloads).toHaveLength(0)
  })
})

describe('registry writes: host result vocabulary', () => {
  interface Case {
    readonly name: string
    readonly reply?: WireReply
    readonly network?: boolean
    readonly code: string
    readonly message: string
    readonly file?: string
  }

  const cases: readonly Case[] = [
    {
      name: '400 envelope maps to invalid-edit',
      reply: { status: 400, body: { error: { code: 'invalid-request', message: 'request body is not valid JSON' } } },
      code: 'invalid-edit',
      message: 'request body is not valid JSON',
    },
    {
      name: '403 maps to invalid-edit',
      reply: { status: 403, body: { error: { code: 'forbidden', message: 'mutation marker required' } } },
      code: 'invalid-edit',
      message: 'mutation marker required',
    },
    {
      name: '404 maps to not-found',
      reply: {
        status: 404,
        body: {
          error: { code: 'not-found', message: 'registry has no entry named "ghost"' },
          report: { results: [{ ok: false, file: undefined, code: 'not-found', message: 'registry has no entry named "ghost"' }] },
        },
      },
      code: 'not-found',
      message: 'registry has no entry named "ghost"',
    },
    {
      name: '404 ignores a drifted report row code',
      reply: {
        status: 404,
        body: {
          error: { code: 'not-found', message: 'missing entry' },
          report: { results: [{ ok: false, file: REGISTRY, code: 'invalid-content', message: 'drifted row' }] },
        },
      },
      code: 'not-found',
      message: 'missing entry',
    },
    {
      name: '409 keeps the report row code conflict',
      reply: {
        status: 409,
        body: {
          error: { code: 'conflict', message: 'registry.yaml is overridden' },
          report: { results: [{ ok: false, file: REGISTRY, code: 'conflict', message: 'registry.yaml is overridden' }] },
        },
      },
      code: 'conflict',
      message: 'registry.yaml is overridden',
      file: REGISTRY,
    },
    {
      name: '409 keeps the report row code read-only',
      reply: {
        status: 409,
        body: {
          error: { code: 'read-only', message: 'built-in entries are not user-editable' },
          report: { results: [{ ok: false, file: undefined, code: 'read-only', message: 'built-in entries are not user-editable' }] },
        },
      },
      code: 'read-only',
      message: 'built-in entries are not user-editable',
    },
    {
      name: '409 without a report falls back to conflict',
      reply: { status: 409, body: { error: { code: 'conflict', message: 'conflict without report' } } },
      code: 'conflict',
      message: 'conflict without report',
    },
    {
      name: '413 maps to invalid-edit',
      reply: { status: 413, body: { error: { code: 'payload-too-large', message: 'request body exceeds 1048576 bytes' } } },
      code: 'invalid-edit',
      message: 'request body exceeds 1048576 bytes',
    },
    {
      name: '415 maps to invalid-edit',
      reply: { status: 415, body: { error: { code: 'unsupported-media-type', message: 'request body must be application/json' } } },
      code: 'invalid-edit',
      message: 'request body must be application/json',
    },
    {
      name: '500 keeps the report row code invalid-content',
      reply: {
        status: 500,
        body: {
          error: { code: 'internal', message: 'layer file does not parse' },
          report: { results: [{ ok: false, file: REGISTRY, code: 'invalid-content', message: 'layer file does not parse' }] },
        },
      },
      code: 'invalid-content',
      message: 'layer file does not parse',
      file: REGISTRY,
    },
    {
      name: '500 without a report falls back to io-error',
      reply: { status: 500, body: { error: { code: 'internal', message: 'boom' } } },
      code: 'io-error',
      message: 'boom',
    },
    {
      name: 'network failure uses the separate network code',
      network: true,
      code: 'network',
      message: 'fetch failed',
    },
  ]

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const h = testCase.network === true ? networkHarness() : harness([testCase.reply as WireReply])
      const outcome = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })

      expect(outcome.status).toBe('failed')
      expect(outcome.changedCount).toBe(0)
      expect(outcome.rows).toHaveLength(1)
      expect(outcome.rows[0]).toMatchObject({
        ok: false,
        editIndex: 0,
        code: testCase.code,
        message: testCase.message,
      })
      if (testCase.file !== undefined) expect(outcome.rows[0]).toMatchObject({ file: testCase.file })
      expect(h.reloads).toHaveLength(0)
    })
  }

  it('a non-2xx report cannot smuggle an ok row into changedCount', async () => {
    const h = harness([{
      status: 409,
      body: {
        error: { code: 'conflict', message: 'mixed report' },
        report: { results: [
          { ok: true, file: REGISTRY },
          { ok: false, file: REGISTRY, code: 'conflict', message: 'mixed report' },
        ] },
      },
    }])
    const outcome = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('failed')
    expect(outcome.changedCount).toBe(0)
    expect(outcome.rows).toHaveLength(1)
    expect(outcome.rows[0]).toMatchObject({ ok: false, code: 'conflict', message: 'mixed report' })
    expect(h.reloads).toHaveLength(0)
  })
})

describe('registry writes: batch', () => {
  it('sends edits serially, keeps going after a failure, and aggregates per-edit rows', async () => {
    const h = harness([
      OK_REPLY,
      {
        status: 409,
        body: {
          error: { code: 'conflict', message: 'second failed' },
          report: { results: [{ ok: false, file: REGISTRY, code: 'conflict', message: 'second failed' }] },
        },
      },
      OK_REPLY,
    ])
    const outcome = await h.writer.run([EDIT, EDIT, EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('partial')
    expect(outcome.changedCount).toBe(2)
    expect(outcome.rows.map((row) => row.ok)).toEqual([true, false, true])
    expect(outcome.rows.map((row) => row.editIndex)).toEqual([0, 1, 2])
    expect(h.reloads).toHaveLength(1)
  })

  it('does not reload when the whole batch failed', async () => {
    const h = harness([
      { status: 404, body: { error: { code: 'not-found', message: 'missing one' } } },
      { status: 404, body: { error: { code: 'not-found', message: 'missing two' } } },
    ])
    const outcome = await h.writer.run([EDIT, EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('failed')
    expect(outcome.changedCount).toBe(0)
    expect(outcome.rows).toHaveLength(2)
    expect(h.reloads).toHaveLength(0)
  })

  it('rejects a second batch while one is in flight without sending a request', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = harnessWithFetch(async () => {
      await gate
      return new Response(JSON.stringify(OK_REPLY.body), { status: 200, headers: JSON_HEADERS })
    })

    const first = h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })
    await Promise.resolve()
    expect(h.writer.isBusy()).toBe(true)

    const second = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })
    expect(second).toEqual({ status: 'busy', rows: [], changedCount: 0 })
    expect(h.fetchCalls()).toBe(1)

    release()
    const firstOutcome = await first
    expect(firstOutcome.status).toBe('ok')
  })
})

describe('registry writes: transport contract', () => {
  it('sends all seven edit kinds to the registry route with { edit, cwd }', async () => {
    const edits: readonly RegistryEdit[] = [
      { kind: 'setAvailable', modelName: 'gpt5', available: false },
      { kind: 'setSysPrompt', modelName: 'gpt5', sysPrompt: 'be terse' },
      { kind: 'remapAlias', alias: 'smart', target: 'gpt5' },
      { kind: 'deleteAlias', alias: 'legacy' },
      { kind: 'deleteModel', modelName: 'old' },
      { kind: 'addAlias', alias: 'fast', target: 'gpt5', source: 'project-dsh' },
      {
        kind: 'addModel',
        modelName: 'new',
        provider: 'acme',
        model: 'chat',
        sysPrompt: 'x',
        available: false,
        source: 'user-dsh',
      },
    ]
    const h = harness([OK_REPLY])
    const outcome = await h.writer.run(edits, { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('ok')
    expect(outcome.changedCount).toBe(edits.length)
    expect(h.requests).toHaveLength(edits.length)
    for (const [index, request] of h.requests.entries()) {
      expect(request.url).toBe('http://host/agent-atelier/registry')
      expect(request.method).toBe('POST')
      expect(request.headers[CLIENT_MARKER_HEADER]).toBe(CLIENT_MARKER_VALUE)
      expect(request.headers['content-type']).toBe('application/json')
      expect(request.body).toEqual({ edit: edits[index], cwd: PROJECT })
    }
    expect(h.reloads).toHaveLength(1)
  })
})
describe('registry writes: abort and reload failure', () => {
  it('rethrows AbortError without sending, reloading, or staying busy', async () => {
    const h = harness([OK_REPLY])
    const controller = new AbortController()
    controller.abort()

    const error = await h.writer.run([EDIT], { cwd: PROJECT, signal: controller.signal }).catch((caught) => caught)
    expect(isAbortError(error)).toBe(true)
    expect(h.fetchCalls()).toBe(0)
    expect(h.reloads).toHaveLength(0)
    expect(h.writer.isBusy()).toBe(false)

    const fresh = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })
    expect(fresh.status).toBe('ok')
  })

  it('keeps the write rows and reports the reload error when the read-back fails', async () => {
    const h = harness([OK_REPLY], async () => { throw new Error('state read failed') })
    const outcome = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() })

    expect(outcome.status).toBe('ok')
    expect(outcome.changedCount).toBe(1)
    expect(outcome.rows[0]).toMatchObject({ ok: true, file: REGISTRY })
    expect(outcome.reloadError).toBe('state read failed')
    expect(outcome.snapshot).toBeUndefined()
    expect(h.reloads).toHaveLength(1)
  })

  it('maps an abort raised during reload back to AbortError', async () => {
    const h = harness([OK_REPLY], async () => { throw abortError() })
    const error = await h.writer.run([EDIT], { cwd: PROJECT, signal: signal() }).catch((caught) => caught)
    expect(isAbortError(error)).toBe(true)
    expect(h.writer.isBusy()).toBe(false)
  })

  it('stops after a mid-batch abort without reloading', async () => {
    const controller = new AbortController()
    let applied = 0
    const reloads: ReloadOptions[] = []
    const writer = createRegistryWriter({
      applyRegistryEdit: async () => {
        applied += 1
        if (applied === 1) controller.abort()
        return { results: [{ ok: true, file: REGISTRY }] }
      },
      reloadAfterWrite: async (options) => {
        reloads.push(options)
        return SNAPSHOT
      },
    })

    const error = await writer.run([EDIT, EDIT], { cwd: PROJECT, signal: controller.signal }).catch((caught) => caught)
    expect(isAbortError(error)).toBe(true)
    expect(applied).toBe(1)
    expect(reloads).toHaveLength(0)
    expect(writer.isBusy()).toBe(false)
  })
})
