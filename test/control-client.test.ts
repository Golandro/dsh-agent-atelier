import { describe, expect, it } from 'vitest'

import { ControlClientError, createMemoryControlClient } from '../src/control/index.ts'
import { createHttpControlClient } from '../src/control/http-client.ts'
import { createInMemoryControlCore } from '../src/control/memory.ts'
import { dispatchControlRequest } from '../src/dsh/host/index.ts'

import type { ControlClient } from '../src/control/index.ts'
import type { InMemoryControlCore } from '../src/control/memory.ts'

const PROJECT = '/client-proj'
const HOME = '/client-home'
const AGENTS = `${PROJECT}/.dsh/agents`
const DOC = `${AGENTS}/alpha/alpha.agent.md`
const REGISTRY = `${AGENTS}/registry.yaml`
const DOC_TEXT = '---\nname: Alpha\ndescription: first\n---\nAlpha body\n'
const REGISTRY_TEXT = 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\n'

const DESCRIPTION_EDIT = {
  kind: 'setFrontmatterField',
  agentName: 'alpha',
  field: 'description',
  value: 'second',
} as const

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

/** A fetch double that forwards to the real wire dispatcher. */
function bridge(core: InMemoryControlCore): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const result = await dispatchControlRequest({
      control: core,
      method: init?.method ?? 'GET',
      pathname: url.pathname,
      search: url.searchParams,
      headers,
      bodyText: typeof init?.body === 'string' ? init.body : null,
      signal: init?.signal ?? undefined,
      scanId: 1,
    })
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

interface AdapterPair {
  readonly name: string
  readonly memory: ControlClient
  readonly http: ControlClient
  readonly memoryCore: InMemoryControlCore
  readonly httpCore: InMemoryControlCore
}

/** One fixture mounted behind both adapters, each over its own files. */
function adapters(): AdapterPair {
  const memoryCore = createCore()
  const httpCore = createCore()
  return {
    name: 'memory/http',
    memory: createMemoryControlClient(memoryCore),
    http: createHttpControlClient({ baseUrl: 'http://host/agent-atelier', fetchImpl: bridge(httpCore), cwd: PROJECT }),
    memoryCore,
    httpCore,
  }
}

describe('control client adapters', () => {
  it('snapshot returns the same domain data through both adapters', async () => {
    const pair = adapters()
    const [memory, http] = await Promise.all([pair.memory.snapshot(), pair.http.snapshot()])

    expect(memory.agents.map((agent) => agent.agentName)).toEqual(['alpha'])
    expect(http.agents.map((agent) => agent.agentName)).toEqual(['alpha'])
    expect(http.models.map((model) => model.modelName)).toEqual(memory.models.map((model) => model.modelName))
    expect(http.findings).toEqual(memory.findings)
  })

  it('compose returns the byte-exact document through both adapters', async () => {
    const pair = adapters()
    const [memory, http] = await Promise.all([pair.memory.compose('alpha'), pair.http.compose('alpha')])

    expect(http.agentName).toBe(memory.agentName)
    expect(http.frontmatterText).toBe(memory.frontmatterText)
    expect(http.bodyText).toBe(memory.bodyText)
    expect(http.baseText).toBe(memory.baseText)
  })

  it('plan previews identical entries and rejections without writing', async () => {
    const pair = adapters()
    const [memory, http] = await Promise.all([
      pair.memory.plan('alpha', [DESCRIPTION_EDIT]),
      pair.http.plan('alpha', [DESCRIPTION_EDIT]),
    ])

    expect(http.entries).toEqual(memory.entries)
    expect(http.rejections).toEqual(memory.rejections)
    expect(pair.memoryCore.files.get(DOC)).toBe(DOC_TEXT)
    expect(pair.httpCore.files.get(DOC)).toBe(DOC_TEXT)
  })

  it('commit writes identical bytes through both adapters', async () => {
    const pair = adapters()
    const [memory, http] = await Promise.all([
      pair.memory.commit([DESCRIPTION_EDIT]),
      pair.http.commit([DESCRIPTION_EDIT]),
    ])

    expect(http).toEqual(memory)
    expect(pair.memoryCore.files.get(DOC)).toBe(pair.httpCore.files.get(DOC))
    expect(pair.httpCore.files.get(DOC)).toContain('description: second')
  })

  it('applyRegistryEdit lands the same registry bytes through both adapters', async () => {
    const pair = adapters()
    const edit = { kind: 'setAvailable', modelName: 'gpt5', available: false } as const
    const [memory, http] = await Promise.all([
      pair.memory.applyRegistryEdit(edit),
      pair.http.applyRegistryEdit(edit),
    ])

    expect(http).toEqual(memory)
    expect(pair.memoryCore.files.get(REGISTRY)).toBe(pair.httpCore.files.get(REGISTRY))
    expect(pair.httpCore.files.get(REGISTRY)).toContain('available: false')
  })

  it('keeps plan rejections as data but rejects a commit that would drop edits', async () => {
    const pair = adapters()
    const unknown = [{ ...DESCRIPTION_EDIT, agentName: 'ghost' }]

    const planned = await pair.http.plan('ghost', unknown)
    expect(planned.rejections.map((rejection) => rejection.code)).toEqual(['unknown-agent'])

    await expect(pair.memory.commit(unknown)).rejects.toMatchObject({ status: 400, code: 'edit-rejected' })
    await expect(pair.http.commit(unknown)).rejects.toMatchObject({ status: 400, code: 'edit-rejected' })
  })

  it('maps an unknown agent to a 404 client error through both adapters', async () => {
    const pair = adapters()
    const memory = pair.memory.compose('ghost')
    const http = pair.http.compose('ghost')
    await expect(memory).rejects.toBeInstanceOf(ControlClientError)
    await expect(memory).rejects.toMatchObject({ status: 404, code: 'not-found' })
    await expect(http).rejects.toMatchObject({ status: 404, code: 'not-found' })
  })

  it('rejects pre-aborted calls with an AbortError through both adapters', async () => {
    const pair = adapters()
    const controller = new AbortController()
    controller.abort()
    await expect(pair.memory.snapshot({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(pair.http.snapshot({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
