import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { AGENT_CONTROL_SERVICE } from '../src/contract/index.ts'
import { createInMemoryControlCore } from '../src/control/memory.ts'
import {
  CLIENT_MARKER_HEADER,
  CONTROL_ROUTE_PATHS,
  MAX_BODY_BYTES,
  applyUiHost,
  optionalSelectionPolicy,
  dispatchControlRequest,
  handleControlRequest,
} from '../src/dsh/host/index.ts'

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ControlCore } from '../src/control/index.ts'
import type { InMemoryControlCore } from '../src/control/memory.ts'
import type { ControlDispatchInput, ControlDispatchResult } from '../src/dsh/host/index.ts'

const PROJECT = '/wire-proj'
const HOME = '/wire-home'
const AGENTS = `${PROJECT}/.dsh/agents`
const DOC = `${AGENTS}/alpha/alpha.agent.md`
const REGISTRY = `${AGENTS}/registry.yaml`
const DOC_TEXT = '---\nname: Alpha\ndescription: first\n---\nAlpha body\n'
const REGISTRY_TEXT = 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\n'

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  [CLIENT_MARKER_HEADER]: '1',
}

/** One in-memory control core with a single fenced agent and one model. */
function createCore(): InMemoryControlCore {
  return createInMemoryControlCore({
    projectRoot: PROJECT,
    dshHome: HOME,
    files: {
      [`${PROJECT}/.git`]: '',
      [DOC]: DOC_TEXT,
      [REGISTRY]: REGISTRY_TEXT,
    },
  })
}

interface CallOptions {
  readonly method?: string | undefined
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly search?: URLSearchParams | undefined
  readonly signal?: AbortSignal | undefined
  readonly scanId?: number | undefined
}

/** Dispatch one request with the standard headers unless a test overrides them. */
async function call(core: ControlCore, pathname: string, options: CallOptions = {}): Promise<ControlDispatchResult> {
  const method = options.method ?? (pathname.endsWith('/state') ? 'GET' : 'POST')
  const input: ControlDispatchInput = {
    control: core,
    method,
    pathname,
    search: options.search ?? new URLSearchParams(),
    headers: options.headers ?? JSON_HEADERS,
    bodyText: options.body === undefined ? null : JSON.stringify(options.body),
    signal: options.signal,
    scanId: options.scanId ?? 1,
  }
  return await dispatchControlRequest(input)
}

const DESCRIPTION_EDIT = {
  kind: 'setFrontmatterField',
  agentName: 'alpha',
  field: 'description',
  value: 'second',
} as const

describe('wire dispatcher', () => {
  it('GET /state returns the snapshot with cwd and scan token', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/state', {
      search: new URLSearchParams({ cwd: PROJECT }),
      headers: {},
      scanId: 7,
    })

    expect(result.status).toBe(200)
    const body = result.body as { cwd: string; scanId: number; snapshot: { agents: { agentName: string }[] } }
    expect(body.cwd).toBe(PROJECT)
    expect(body.scanId).toBe(7)
    expect(body.snapshot.agents.map((agent) => agent.agentName)).toEqual(['alpha'])
  })

  it('POST /compose returns the domain document and 404s an unknown agent', async () => {
    const core = createCore()
    const ok = await call(core, '/agent-atelier/compose', { body: { agentName: 'alpha', cwd: PROJECT } })
    expect(ok.status).toBe(200)
    const body = ok.body as { cwd: string; document: { agentName: string; frontmatterText: string } }
    expect(body.cwd).toBe(PROJECT)
    expect(body.document.agentName).toBe('alpha')
    expect(body.document.frontmatterText).toContain('description: first')

    const missing = await call(core, '/agent-atelier/compose', { body: { agentName: 'ghost', cwd: PROJECT } })
    expect(missing.status).toBe(404)
    expect((missing.body as { error: { code: string } }).error.code).toBe('not-found')
  })

  it('POST /plan previews writes without touching the disk', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/plan', { body: { edits: [DESCRIPTION_EDIT], cwd: PROJECT } })

    expect(result.status).toBe(200)
    const plan = (result.body as { plan: { entries: { file: string; content: string }[]; rejections: unknown[] } }).plan
    expect(plan.rejections).toEqual([])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]?.file).toBe(DOC)
    expect(plan.entries[0]?.content).toContain('description: second')
    expect(core.files.get(DOC)).toBe(DOC_TEXT)
  })

  it('POST /commit writes the file and returns the per-file report', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/commit', { body: { edits: [DESCRIPTION_EDIT], cwd: PROJECT } })

    expect(result.status).toBe(200)
    const report = (result.body as { report: { results: unknown[] } }).report
    expect(report.results).toEqual([{ ok: true, file: DOC }])
    expect(core.files.get(DOC)).toContain('description: second')
  })

  it('POST /commit refuses a plan with rejected edits as 400 and writes nothing', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/commit', {
      body: { edits: [{ ...DESCRIPTION_EDIT, agentName: 'ghost' }], cwd: PROJECT },
    })

    expect(result.status).toBe(400)
    const body = result.body as { error: { code: string }; rejections: { code: string }[] }
    expect(body.error.code).toBe('edit-rejected')
    expect(body.rejections[0]?.code).toBe('unknown-agent')
    expect(core.files.get(DOC)).toBe(DOC_TEXT)
  })

  it('POST /commit maps a write conflict to 409', async () => {
    const base = createCore()
    const conflicting: ControlCore = {
      ...base,
      async commit() {
        return { results: [{ ok: false, file: DOC, code: 'conflict', message: 'file changed on disk' }] }
      },
    }
    const result = await call(conflicting, '/agent-atelier/commit', { body: { edits: [DESCRIPTION_EDIT], cwd: PROJECT } })

    expect(result.status).toBe(409)
    expect((result.body as { error: { code: string } }).error.code).toBe('conflict')
  })

  it('POST /commit maps a read-only refusal to 409 with the read-only code', async () => {
    const base = createCore()
    const readOnly: ControlCore = {
      ...base,
      async commit() {
        return { results: [{ ok: false, file: DOC, code: 'read-only', message: 'file is read-only' }] }
      },
    }
    const result = await call(readOnly, '/agent-atelier/commit', { body: { edits: [DESCRIPTION_EDIT], cwd: PROJECT } })

    expect(result.status).toBe(409)
    expect((result.body as { error: { code: string } }).error.code).toBe('read-only')
  })

  it('POST /registry applies a tuning edit and maps unknown models to 404', async () => {
    const core = createCore()
    const ok = await call(core, '/agent-atelier/registry', {
      body: { edit: { kind: 'setAvailable', modelName: 'gpt5', available: false }, cwd: PROJECT },
    })
    expect(ok.status).toBe(200)
    expect(core.files.get(REGISTRY)).toContain('available: false')

    const missing = await call(core, '/agent-atelier/registry', {
      body: { edit: { kind: 'setAvailable', modelName: 'nope', available: false }, cwd: PROJECT },
    })
    expect(missing.status).toBe(404)
    expect((missing.body as { error: { code: string } }).error.code).toBe('not-found')
  })

  it('POST /invalidate answers with a fresh scan token', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/invalidate', { body: {}, scanId: 3 })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, scanId: 3 })
  })

  it('rejects oversized bodies, missing markers, wrong media types and wrong methods', async () => {
    const core = createCore()
    const oversized = await dispatchControlRequest({
      control: core,
      method: 'POST',
      pathname: '/agent-atelier/commit',
      search: new URLSearchParams(),
      headers: JSON_HEADERS,
      bodyText: 'x'.repeat(MAX_BODY_BYTES + 1),
      scanId: 1,
    })
    expect(oversized.status).toBe(413)

    const noMarker = await call(core, '/agent-atelier/commit', {
      body: { edits: [] },
      headers: { 'content-type': 'application/json' },
    })
    expect(noMarker.status).toBe(403)

    const wrongType = await call(core, '/agent-atelier/commit', {
      body: { edits: [] },
      headers: { 'content-type': 'text/plain', [CLIENT_MARKER_HEADER]: '1' },
    })
    expect(wrongType.status).toBe(415)

    const wrongMethod = await call(core, '/agent-atelier/compose', { method: 'GET' })
    expect(wrongMethod.status).toBe(405)
  })

  it('rejects malformed JSON and non-object bodies', async () => {
    const core = createCore()
    const malformed = await dispatchControlRequest({
      control: core,
      method: 'POST',
      pathname: '/agent-atelier/plan',
      search: new URLSearchParams(),
      headers: JSON_HEADERS,
      bodyText: '{',
      scanId: 1,
    })
    expect(malformed.status).toBe(400)
    expect((malformed.body as { error: { code: string } }).error.code).toBe('invalid-request')

    const array = await call(core, '/agent-atelier/plan', { body: [] })
    expect(array.status).toBe(400)
  })

  it('reports cancellation instead of running the core', async () => {
    const core = createCore()
    const controller = new AbortController()
    controller.abort()
    const result = await call(core, '/agent-atelier/state', {
      search: new URLSearchParams({ cwd: PROJECT }),
      headers: {},
      signal: controller.signal,
    })
    expect(result.status).toBe(499)
    expect((result.body as { error: { code: string } }).error.code).toBe('aborted')
  })
})

describe('host row wiring', () => {
  it('registers six exact routes and unmounts them with the effect', () => {
    const ctx = new Context()
    const routes = new Map<string, { kind: string; path: string }>()
    ctx.provide(AGENT_CONTROL_SERVICE, createCore())
    ctx.provide('webServer', {
      register(route: { kind: string; path: string }) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    })

    applyUiHost(ctx)

    expect([...routes.keys()].sort()).toEqual([...CONTROL_ROUTE_PATHS].sort())
    expect([...routes.values()].every((route) => route.kind === 'exact')).toBe(true)
  })

  it('turns the host model-selection setting into a policy, read at use time', () => {
    let allowed: { provider: string; model: string }[] = [{ provider: 'openai', model: 'gpt-5' }]
    const ctx = new Context()
    ctx.provide('subagentModelSelection', { current: () => ({ allowedModels: allowed }) })
    expect(optionalSelectionPolicy(ctx)).toEqual({ routes: [{ provider: 'openai', model: 'gpt-5' }] })

    // The native default (no routes) is "the preference is off", never "refuse
    // everything": it must not become an empty allowlist.
    allowed = []
    expect(optionalSelectionPolicy(ctx)).toBeUndefined()

    // Malformed rows are skipped rather than trusted; nothing left is no policy.
    const malformed = new Context()
    malformed.provide('subagentModelSelection', {
      current: () => ({ allowedModels: [{ provider: 'x', model: '' }, { provider: 7 }] as never }),
    })
    expect(optionalSelectionPolicy(malformed)).toBeUndefined()
    // No service at all is no policy either.
    expect(optionalSelectionPolicy(new Context())).toBeUndefined()
  })

  it('applies the connection trust fence before dispatching', async () => {
    const res = fakeResponse()
    await handleControlRequest(
      { method: 'GET', url: '/agent-atelier/state', headers: {} } as unknown as IncomingMessage,
      res.response,
      {
        control: createCore(),
        connection: { requestRejection: () => 403 },
        nextScanId: () => 1,
      },
    )

    expect(res.status()).toBe(403)
    expect(res.body() as { error: { code: string } }).toMatchObject({ error: { code: 'forbidden' } })
  })
})

/** Minimal ServerResponse double: captures status and body, no socket. */
function fakeResponse(): { response: ServerResponse; status: () => number; body: () => unknown } {
  let status = 0
  let payload = ''
  const response = {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    setHeader() {},
    on() {},
    off() {},
    destroy() {},
    end(text?: string) {
      payload = text ?? ''
      this.writableEnded = true
    },
  }
  const proxy = new Proxy(response, {
    get(target, key) {
      if (key === 'statusCode') return status
      return Reflect.get(target, key)
    },
    set(target, key, value) {
      if (key === 'statusCode') status = Number(value)
      else Reflect.set(target, key, value)
      return true
    },
  }) as unknown as ServerResponse
  return { response: proxy, status: () => status, body: () => (payload === '' ? undefined : JSON.parse(payload)) }
}
