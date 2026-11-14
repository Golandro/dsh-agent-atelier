import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { AGENT_CONTROL_SERVICE } from '../src/contract/index.ts'
import { createAssemblyService } from '../src/agent-assembly/index.ts'
import { createInMemoryControlCore } from '../src/control/memory.ts'
import { FRONTMATTER_FIELDS, FRONTMATTER_FIELD_KEYS } from '../src/yaml/index.ts'
import {
  CLIENT_MARKER_HEADER,
  CONTROL_ROUTE_PATHS,
  MAX_BODY_BYTES,
  MAX_EDITS,
  applyUiHost,
  optionalSelectionPolicy,
  dispatchControlRequest,
  handleControlRequest,
} from '../src/dsh/host/index.ts'
import { MAX_AGENT_NAME_LENGTH, MAX_FIELD_ITEMS, MAX_FIELD_VALUE_LENGTH } from '../src/dsh/host/wire.ts'
import { createControlFixture } from './support/control-fixture.ts'

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ModelSelectionPolicy } from '../src/contract/index.ts'
import type { ControlCore } from '../src/control/index.ts'
import type { InMemoryControlCore } from '../src/control/memory.ts'
import type { ControlDispatchInput, ControlDispatchResult } from '../src/dsh/host/index.ts'

const fixture = createControlFixture({ projectRoot: '/wire-proj', dshHome: '/wire-home' })
const {
  projectRoot: PROJECT,
  dshHome: HOME,
  agentsDir: AGENTS,
  docPath: DOC,
  registryPath: REGISTRY,
  docText: DOC_TEXT,
  registryText: REGISTRY_TEXT,
  createCore,
} = fixture

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  [CLIENT_MARKER_HEADER]: '1',
}

const CHAIN_REGISTRY = [
  'models:',
  '  good: { provider: deepseek, model: deepseek-chat }',
  '  later: { provider: deepseek, model: deepseek-reasoner }',
  '  off: { provider: vendor, model: retired, available: false }',
  '  forbidden: { provider: vendor, model: secret }',
  'aliases:',
  '  dangling: [nowhere]',
  '  good: [good]',
  '  later: [later]',
  '  off: [off]',
  '  forbidden: [forbidden]',
].join('\n')

const CHAIN_REGISTRY_FILE = `${AGENTS}/registry.yaml`

/** One fixture exercising every skip reason the session path can produce. */
function chainCore(selectionPolicy?: ModelSelectionPolicy): InMemoryControlCore {
  return createInMemoryControlCore({
    projectRoot: PROJECT,
    dshHome: HOME,
    files: {
      [`${PROJECT}/.git`]: '',
      [CHAIN_REGISTRY_FILE]: CHAIN_REGISTRY,
      [`${AGENTS}/mixed/mixed.agent.md`]: '---\nname: mixed\nmodelOrder: [ghost, dangling, off]\n---\nmixed\n',
      [`${AGENTS}/forbidden/forbidden.agent.md`]: '---\nname: forbidden\nmodelOrder: [forbidden]\n---\nforbidden\n',
      [`${AGENTS}/winner/winner.agent.md`]: '---\nname: winner\nmodelOrder: [good, later]\n---\nwinner\n',
    },
    ...selectionPolicy === undefined ? {} : { selectionPolicy },
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

/** The wire error code of a dispatched result; the error body shape is frozen. */
function errorCode(result: ControlDispatchResult): string | undefined {
  return (result.body as { error?: { code?: string } }).error?.code
}

const DESCRIPTION_EDIT = {
  kind: 'setFrontmatterField',
  agentName: 'alpha',
  field: 'description',
  value: 'second',
} as const

/**
 * The list-valued field the field-value table exercises, derived from the shared
 * table so a later field-shape change cannot silently turn those rows into
 * unknown-field rejections that would pass for the wrong reason.
 */
const LIST_FIELD = (() => {
  const field = FRONTMATTER_FIELDS.find((candidate) => candidate.kind === 'array')
  if (field === undefined) throw new Error('the frontmatter table has no list-valued field to exercise')
  return field.key
})()

describe('wire dispatcher', () => {
  it('GET /state returns the snapshot with cwd and scan token', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/state', {
      search: new URLSearchParams({ cwd: PROJECT }),
      headers: {},
      scanId: 7,
    })

    expect(result.status).toBe(200)
    const body = result.body as {
      cwd: string
      scanId: number
      snapshot: {
        agents: { agentName: string }[]
        registryLayers: { source: string; path: string; models: { modelName: string }[] }[]
      }
    }
    expect(body.cwd).toBe(PROJECT)
    expect(body.scanId).toBe(7)
    expect(body.snapshot.agents.map((agent) => agent.agentName)).toEqual(['alpha'])
    // The layered registry projection rides through /state untouched (ticket 57).
    expect(body.snapshot.registryLayers.map((layer) => [layer.source, layer.path, layer.models.map((model) => model.modelName)])).toEqual([
      ['project-dsh', REGISTRY, ['gpt5']],
      ['user-dsh', `${HOME}/agents/registry.yaml`, []],
    ])
  })

  it('GET /state carries the per-agent assembly projection', async () => {
    const core = createInMemoryControlCore({
      projectRoot: PROJECT,
      dshHome: HOME,
      files: {
        [`${PROJECT}/.git`]: '',
        [DOC]: '---\nname: Alpha\nmodelOrder: [smart]\n---\nAlpha body\n',
        [REGISTRY]: 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\naliases:\n  smart: [gpt5]\n',
      },
      assembly: createAssemblyService(),
    })
    const result = await call(core, '/agent-atelier/state', {
      search: new URLSearchParams({ cwd: PROJECT }),
      headers: {},
    })

    expect(result.status).toBe(200)
    const body = result.body as { snapshot: { assemblies: Record<string, { sections: { name: string }[] }> } }
    // No sysPrompt on gpt5, so the plan has the persona row but no model row.
    expect(body.snapshot.assemblies.alpha?.sections.map((section) => section.name)).toEqual([
      'channel:tools',
      'deployment:persona-prefix',
      'atelier:skills',
      'channel:digest',
      'channel:first-message',
      'channel:pre-step',
    ])
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
    expect(errorCode(missing)).toBe('not-found')
  })

  it('POST /chain returns the report and keeps exhaustion at 200', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/chain', { body: { agentName: 'alpha', cwd: PROJECT } })

    expect(result.status).toBe(200)
    const body = result.body as { cwd: string; exhausted: boolean; report: { selectedBy: string; candidates: unknown[] } }
    expect(body.cwd).toBe(PROJECT)
    expect(body.exhausted).toBe(true)
    expect(body.report.selectedBy).toBe('none')
    // The route adds no interpretation: it is the core's report as-is.
    expect(body.report).toEqual((await core.chainReport('alpha', { cwd: PROJECT })).report)
  })

  it('POST /chain 404s an unknown agent and 400s a malformed request', async () => {
    const core = createCore()
    const missing = await call(core, '/agent-atelier/chain', { body: { agentName: 'ghost', cwd: PROJECT } })
    expect(missing.status).toBe(404)
    expect(errorCode(missing)).toBe('not-found')

    const nameless = await call(core, '/agent-atelier/chain', { body: { cwd: PROJECT } })
    expect(nameless.status).toBe(400)
    expect(errorCode(nameless)).toBe('invalid-request')

    const wrongMethod = await call(core, '/agent-atelier/chain', { method: 'GET', headers: {} })
    expect(wrongMethod.status).toBe(405)
  })

  it('POST /chain forwards every skip reason the session path can produce', async () => {
    const refused = chainCore({ routes: [] })
    const allowed = chainCore()

    const mixed = await call(refused, '/agent-atelier/chain', { body: { agentName: 'mixed', cwd: PROJECT } })
    const forbidden = await call(refused, '/agent-atelier/chain', { body: { agentName: 'forbidden', cwd: PROJECT } })
    const winner = await call(allowed, '/agent-atelier/chain', { body: { agentName: 'winner', cwd: PROJECT } })

    type ChainBody = { exhausted: boolean; report: { aliasChain: { skipped?: string }[]; candidates: { skipped?: string }[] } }
    const mixedBody = mixed.body as ChainBody
    expect(mixedBody.exhausted).toBe(true)
    expect(mixedBody.report.aliasChain[0]).toMatchObject({ alias: 'ghost', skipped: 'unknown-alias' })
    expect(mixedBody.report.candidates.map((candidate) => candidate.skipped)).toEqual(['unknown-model', 'unavailable'])
    expect((forbidden.body as ChainBody).report.candidates.map((candidate) => candidate.skipped)).toEqual(['not-allowed'])
    const winnerBody = winner.body as ChainBody
    expect(winnerBody.exhausted).toBe(false)
    expect(winnerBody.report.candidates.map((candidate) => candidate.skipped)).toEqual([undefined, 'not-reached'])
    // `unsupported-effort` stays engine-only here: neither the session path nor
    // the read face injects a supportedEfforts table, and the route invents nothing.
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

  it('refuses an unknown frontmatter field and keeps the table order in the message', async () => {
    const core = createCore()
    const rejected = await call(core, '/agent-atelier/plan', {
      body: { edits: [{ ...DESCRIPTION_EDIT, field: 'nickname' }], cwd: PROJECT },
    })

    expect(rejected.status).toBe(400)
    expect((rejected.body as { error: { code: string; message: string } }).error).toEqual({
      code: 'invalid-request',
      message: `edits[0]: field must be one of ${FRONTMATTER_FIELD_KEYS.join(', ')}`,
    })
    expect(core.files.get(DOC)).toBe(DOC_TEXT)
  })

  it('accepts every legal field from the shared table without changing its order', async () => {
    const core = createCore()
    for (const { key, kind } of FRONTMATTER_FIELDS) {
      const value = kind === 'scalar' ? (key === 'spawn' ? 'spawn' : `${key}-value`) : [`${key}-item`]
      const result = await call(core, '/agent-atelier/plan', {
        body: { edits: [{ ...DESCRIPTION_EDIT, field: key, value }], cwd: PROJECT },
      })
      expect(result.status, key).toBe(200)
      expect((result.body as { plan: { rejections: unknown[] } }).plan.rejections, key).toEqual([])
    }
    expect(FRONTMATTER_FIELD_KEYS).toEqual(FRONTMATTER_FIELDS.map((field) => field.key))
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
    expect(errorCode(result)).toBe('conflict')
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
    expect(errorCode(result)).toBe('read-only')
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
    expect(errorCode(missing)).toBe('not-found')
  })

  it('POST /invalidate answers with a fresh scan token', async () => {
    const core = createCore()
    const result = await call(core, '/agent-atelier/invalidate', { body: {}, scanId: 3 })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, scanId: 3 })
  })

  /** The four body-envelope fences, one request each: status and wire code. */
  const ENVELOPE_CASES: readonly {
    readonly label: string
    readonly dispatch: (core: ControlCore) => Promise<ControlDispatchResult>
    readonly status: number
    readonly code: string
  }[] = [
    {
      label: 'an oversized body',
      dispatch: (core) => dispatchControlRequest({
        control: core,
        method: 'POST',
        pathname: '/agent-atelier/commit',
        search: new URLSearchParams(),
        headers: JSON_HEADERS,
        bodyText: 'x'.repeat(MAX_BODY_BYTES + 1),
        scanId: 1,
      }),
      status: 413,
      code: 'payload-too-large',
    },
    {
      label: 'a mutation without the client marker',
      dispatch: (core) => call(core, '/agent-atelier/commit', {
        body: { edits: [] },
        headers: { 'content-type': 'application/json' },
      }),
      status: 403,
      code: 'forbidden',
    },
    {
      label: 'a body declared as text/plain',
      dispatch: (core) => call(core, '/agent-atelier/commit', {
        body: { edits: [] },
        headers: { 'content-type': 'text/plain', [CLIENT_MARKER_HEADER]: '1' },
      }),
      status: 415,
      code: 'unsupported-media-type',
    },
    {
      label: 'a GET on a POST-only route',
      dispatch: (core) => call(core, '/agent-atelier/compose', { method: 'GET' }),
      status: 405,
      code: 'method-not-allowed',
    },
  ]

  it.each(ENVELOPE_CASES)('fences $label with $status $code', async ({ dispatch, status, code }) => {
    const result = await dispatch(createCore())

    expect(result.status).toBe(status)
    expect(errorCode(result)).toBe(code)
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
    expect(errorCode(malformed)).toBe('invalid-request')

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
    expect(errorCode(result)).toBe('aborted')
  })
})

/** A core whose read throws, to exercise the dispatcher's 500 mapping. */
function throwingCore(): ControlCore {
  return {
    ...createCore(),
    async snapshot() {
      throw new Error('snapshot failed')
    },
  }
}

const AGENT_NAME_CASES: readonly (readonly [string, unknown])[] = [
  ['a NUL byte', 'al\u0000pha'],
  ['a slash', 'al/pha'],
  ['a backslash', 'al\\pha'],
  ['the parent directory', '..'],
  ['the current directory', '.'],
  ['an empty name', ''],
  ['an over-long name', 'a'.repeat(MAX_AGENT_NAME_LENGTH + 1)],
  ['a non-string name', 7],
]

const CWD_CASES: readonly (readonly [string, unknown])[] = [
  ['a number', 7],
  ['an array', []],
  ['an object', {}],
]

const EDIT_CASES: readonly (readonly [string, unknown])[] = [
  ['a non-array payload', {}],
  ['more entries than the cap allows', Array.from({ length: MAX_EDITS + 1 }, () => DESCRIPTION_EDIT)],
]

const FIELD_VALUE_CASES: readonly (readonly [string, string, unknown])[] = [
  ['a scalar over the value cap', 'description', 'x'.repeat(MAX_FIELD_VALUE_LENGTH + 1)],
  ['a list over the item cap', LIST_FIELD, Array.from({ length: MAX_FIELD_ITEMS + 1 }, (_, index) => `model-${index}`)],
  ['a list item over the value cap', LIST_FIELD, ['x'.repeat(MAX_FIELD_VALUE_LENGTH + 1)]],
  ['a list with a non-string item', LIST_FIELD, ['good', 7]],
]

const REGISTRY_CASES: readonly (readonly [string, unknown])[] = [
  ['a space in modelName', { kind: 'setAvailable', modelName: 'gpt 5', available: false }],
  ['a slash in modelName', { kind: 'setAvailable', modelName: 'gpt/5', available: false }],
  ['an unknown edit kind', { kind: 'renameModel', modelName: 'gpt5' }],
]

const DISPATCH_ERROR_CASES: readonly (readonly [string, number, string, () => Promise<ControlDispatchResult>])[] = [
  ['an unknown route', 404, 'not-found', () => call(createCore(), '/agent-atelier/nope', { body: {} })],
  [
    'a throwing core',
    500,
    'internal',
    () => call(throwingCore(), '/agent-atelier/state', {
      search: new URLSearchParams({ cwd: PROJECT }),
      headers: {},
    }),
  ],
]

describe('wire validation surface', () => {
  it.each(AGENT_NAME_CASES)('rejects an agentName with %s as 400 invalid-request', async (_label, agentName) => {
    const result = await call(createCore(), '/agent-atelier/compose', { body: { agentName, cwd: PROJECT } })

    expect(result.status).toBe(400)
    expect(errorCode(result)).toBe('invalid-request')
  })

  it.each(CWD_CASES)('POST /plan rejects a cwd that is %s as 400 invalid-request', async (_label, cwd) => {
    const result = await call(createCore(), '/agent-atelier/plan', { body: { edits: [DESCRIPTION_EDIT], cwd } })

    expect(result.status).toBe(400)
    expect(errorCode(result)).toBe('invalid-request')
  })

  it.each(EDIT_CASES)('POST /plan rejects edits that are %s as 400 invalid-request', async (_label, edits) => {
    const result = await call(createCore(), '/agent-atelier/plan', { body: { edits, cwd: PROJECT } })

    expect(result.status).toBe(400)
    expect(errorCode(result)).toBe('invalid-request')
  })

  it.each(FIELD_VALUE_CASES)(
    'POST /plan rejects a setFrontmatterField edit with %s as 400 invalid-request',
    async (_label, field, value) => {
      const result = await call(createCore(), '/agent-atelier/plan', {
        body: { edits: [{ kind: 'setFrontmatterField', agentName: 'alpha', field, value }], cwd: PROJECT },
      })

      expect(result.status).toBe(400)
      expect(errorCode(result)).toBe('invalid-request')
    },
  )

  it.each(REGISTRY_CASES)('POST /registry rejects an edit with %s as 400 invalid-request', async (_label, edit) => {
    const result = await call(createCore(), '/agent-atelier/registry', { body: { edit, cwd: PROJECT } })

    expect(result.status).toBe(400)
    expect(errorCode(result)).toBe('invalid-request')
  })

  it.each(DISPATCH_ERROR_CASES)('maps %s to %i %s', async (_label, status, code, dispatch) => {
    const result = await dispatch()

    expect(result.status).toBe(status)
    expect(errorCode(result)).toBe(code)
  })
})

/** A context with the control core and a recording web server, for the row tests. */
function uiHostContext(): { ctx: Context; routes: Map<string, { kind: string; path: string }> } {
  const ctx = new Context()
  const routes = new Map<string, { kind: string; path: string }>()
  ctx.provide(AGENT_CONTROL_SERVICE, createCore())
  ctx.provide('webServer', {
    register(route: { kind: string; path: string }) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  })
  return { ctx, routes }
}

describe('host row wiring', () => {
  it('registers one exact route per control path', () => {
    const { ctx, routes } = uiHostContext()

    applyUiHost(ctx)

    expect([...routes.keys()].sort()).toEqual([...CONTROL_ROUTE_PATHS].sort())
    expect([...routes.values()].every((route) => route.kind === 'exact')).toBe(true)
  })

  it('unmounts every route when the owning plugin row is disposed', async () => {
    // The name promises unmounting, so the disposer actually runs: the routes
    // registered inside `ctx.effect` must be gone once the row's fork disposes.
    const { ctx, routes } = uiHostContext()
    const fork = await ctx.plugin({ apply: applyUiHost })

    expect(routes.size).toBe(CONTROL_ROUTE_PATHS.length)

    await fork.dispose()

    expect([...routes.keys()]).toEqual([])
  })

  it('turns the host model-selection setting into a policy, read at use time', () => {
    let allowed: { provider: string; model: string }[] = [{ provider: 'openai', model: 'gpt-5' }]
    const ctx = new Context()
    ctx.provide('subagentModelSelection', { current: () => ({ enabled: true, allowedModels: allowed }) })
    expect(optionalSelectionPolicy(ctx)).toEqual({ routes: [{ provider: 'openai', model: 'gpt-5' }] })

    // The native default (no routes) is "the preference is off", never "refuse
    // everything": it must not become an empty allowlist.
    allowed = []
    expect(optionalSelectionPolicy(ctx)).toBeUndefined()

    // A disabled setting keeps its routes but must not enforce them: the native
    // service gates the allowlist on `enabled` (and refuses enabled + empty).
    const disabled = new Context()
    disabled.provide('subagentModelSelection', {
      current: () => ({ enabled: false, allowedModels: [{ provider: 'openai', model: 'gpt-5' }] }),
    })
    expect(optionalSelectionPolicy(disabled)).toBeUndefined()

    // Malformed rows are skipped rather than trusted; nothing left is no policy.
    const malformed = new Context()
    malformed.provide('subagentModelSelection', {
      current: () => ({ enabled: true, allowedModels: [{ provider: 'x', model: '' }, { provider: 7 }] as never }),
    })
    expect(optionalSelectionPolicy(malformed)).toBeUndefined()
    // No service at all is no policy either.
    expect(optionalSelectionPolicy(new Context())).toBeUndefined()
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
  ] as const)('applies the connection trust fence before dispatching (%i)', async (rejection, code) => {
    const res = fakeResponse()
    await handleControlRequest(
      { method: 'GET', url: '/agent-atelier/state', headers: {} } as unknown as IncomingMessage,
      res.response,
      {
        control: createCore(),
        connection: { requestRejection: () => rejection },
        nextScanId: () => 1,
      },
    )

    expect(res.status()).toBe(rejection)
    expect(res.body() as { error: { code: string } }).toMatchObject({ error: { code } })
  })
})

describe('wire scope fallback (ticket 37 / ADR-0007)', () => {
  it('missing cwd scans user-global and echoes null', async () => {
    const result = await call(createCore(), '/agent-atelier/state', { headers: {} })

    expect(result.status).toBe(200)
    const body = result.body as {
      cwd: string | null
      snapshot: { agents: unknown[]; scope?: { cwd: string | null; projectRoot: string | null } }
    }
    expect(body.cwd).toBeNull()
    expect(body.snapshot.agents).toEqual([])
    expect(body.snapshot.scope).toMatchObject({ cwd: null, projectRoot: null })
  })

  it('unusable cwd spellings degrade to user-global instead of failing', async () => {
    const core = createCore()
    for (const cwd of ['', 'relative/path', 'a\0b', `/${'x'.repeat(5000)}`]) {
      const result = await call(core, '/agent-atelier/state', {
        search: new URLSearchParams({ cwd }),
        headers: {},
      })
      expect(result.status, `cwd=${JSON.stringify(cwd.slice(0, 20))}`).toBe(200)
      expect((result.body as { cwd: string | null }).cwd).toBeNull()
    }
  })

  it('a non-string cwd is still a protocol error', async () => {
    const result = await call(createCore(), '/agent-atelier/compose', { body: { agentName: 'alpha', cwd: 7 } })

    expect(result.status).toBe(400)
    expect(errorCode(result)).toBe('invalid-request')
  })

  it('state echoes the resolved project root, not just the requested directory', async () => {
    const core = createInMemoryControlCore({
      projectRoot: PROJECT,
      dshHome: HOME,
      files: { [`${PROJECT}/.git`]: '', [DOC]: DOC_TEXT },
      resolveProjectRootFor: async (cwd) => (cwd === PROJECT ? PROJECT : undefined),
    })
    const result = await call(core, '/agent-atelier/state', {
      search: new URLSearchParams({ cwd: PROJECT }),
      headers: {},
    })

    expect(result.status).toBe(200)
    const body = result.body as { snapshot: { scope?: { cwd: string | null; projectRoot: string | null } } }
    expect(body.snapshot.scope).toEqual({ cwd: PROJECT, projectRoot: PROJECT })
  })

  it('registry edits land in the requested workspace, not the host default', async () => {
    const core = createCore()
    const workspace = `${PROJECT}-other`
    const registry = `${workspace}/.dsh/agents/registry.yaml`
    const result = await call(core, '/agent-atelier/registry', {
      body: { edit: { kind: 'setAvailable', modelName: 'gpt5', available: false }, cwd: workspace },
    })

    // The requested workspace was never registered on disk, so its project layer
    // is unavailable: the refusal is honest instead of writing the host default.
    expect(result.status).toBe(404)
    expect(core.files.get(REGISTRY)).toBe(REGISTRY_TEXT)
    expect(core.files.get(registry)).toBeUndefined()
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
