/**
 * 预览端口的适配器对照（票 85）：memory 与 http 两个适配器必须给同一个信封。
 *
 * 两个适配器的能力来源不同，但**对外形状必须一致**：
 * - http 走 wire 的 `/prompt-preview`，服务端投影好 `segments`；
 * - memory 背后是纯 ControlCore，没有宿主服务、跑不了真装配，所以读面靠注入；
 *   没注入时如实 503 `unavailable`，与 wire 在「读面没挂」时的措辞同一条约定。
 *
 * 本测试不跑装配、不跑投影（那是票 83/84 的测试），只钉「搬得对不对、缺得诚不诚实」。
 */
import { describe, expect, it } from 'vitest'

import { createHttpControlClient } from '../src/control/http-client.ts'
import { createMemoryControlClient, previewViewOf } from '../src/control/index.ts'
import { PROMPT_SOURCE_ORDER, PROMPT_PREVIEW_SIDE_EFFECTS } from '../src/contract/index.ts'
import { createControlFixture } from './support/control-fixture.ts'
import { dispatchControlRequest } from '../src/dsh/host/index.ts'

import type { PromptPreviewResponse, PromptPreviewView, PromptSegmentsView } from '../src/contract/index.ts'
import type { InMemoryControlCore } from './support/memory.ts'

const fixture = createControlFixture({ projectRoot: '/client-proj', dshHome: '/client-home' })

/** 7 条来源的空骨架（与装配层的 emptyPromptSegments 同形，这里按契约造）。 */
function skeleton(): PromptSegmentsView {
  return {
    sources: PROMPT_SOURCE_ORDER.map((source) => ({ source, segments: [] })),
    unattributed: [],
    diagnostics: [],
  }
}

/** 档位 ① 的回答：真投影的形状（一段落在 atelier-section）。 */
function fullResponse(): PromptPreviewResponse {
  return {
    cwd: '/client-proj',
    scanId: 5,
    assembledAt: '2026-01-01T00:00:00.000Z',
    ledger: [],
    segments: {
      sources: PROMPT_SOURCE_ORDER.map((source) => ({
        source,
        segments: source === 'atelier-section'
          ? [{ name: 'atelier:model-sys', surface: 'section' as const, text: 'route {{model}}', source }]
          : [],
      })),
      unattributed: [],
      diagnostics: [],
    },
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: ['新鲜度：只带装配时刻。'],
  }
}

/** 档位 ③ 的回答：空骨架 + degraded。 */
function staticResponse(): PromptPreviewResponse {
  return {
    cwd: null,
    scanId: 6,
    assembledAt: '2026-01-01T00:00:00.000Z',
    ledger: [],
    segments: skeleton(),
    degraded: { tier: 'static', reason: '该 agent 当前没有活跃会话', missing: [{ item: 'live-agent', reason: '没有活跃会话' }] },
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: [],
  }
}

/** 把 http 适配器的 fetch 接到真 wire 分发器上。 */
function bridge(core: InMemoryControlCore, preview: (agentName: string) => Promise<PromptPreviewResponse>): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const result = await dispatchControlRequest({
      control: core,
      method: init?.method ?? 'GET',
      pathname: url.pathname,
      search: url.searchParams,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      bodyText: typeof init?.body === 'string' ? init.body : null,
      signal: init?.signal ?? undefined,
      scanId: 1,
      preview: { preview: async (request) => await preview(request.agentName) },
    })
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('预览端口：两个适配器给同一个信封', () => {
  it('档位 ①：http 与 memory 拿到逐字段相同的渲染信封', async () => {
    const response = fullResponse()
    const core = fixture.createCore()
    const http = createHttpControlClient({
      baseUrl: 'http://host/agent-atelier',
      fetchImpl: bridge(core, async () => response),
      cwd: fixture.projectRoot,
    })
    const memory = createMemoryControlClient(core, {
      cwd: fixture.projectRoot,
      preview: async (agentName) => previewViewOf(response, agentName),
    })

    const [overHttp, overMemory] = await Promise.all([
      http.promptPreview('alpha'),
      memory.promptPreview('alpha'),
    ])

    expect(overHttp).toEqual(overMemory)
    // 信封的关键事实：段由服务端投影好，客户端只搬。
    expect(overHttp.segments.sources.map((group) => group.source)).toEqual([...PROMPT_SOURCE_ORDER])
    expect(overHttp.segments.sources.find((g) => g.source === 'atelier-section')?.segments).toHaveLength(1)
    expect(overHttp.degraded).toBeUndefined()
    expect(overHttp.agentName).toBe('alpha')
    expect(overHttp.sideEffects.length).toBeGreaterThan(0)
  })

  it('档位 ③：空骨架 + degraded 原样穿过两个适配器', async () => {
    const response = staticResponse()
    const core = fixture.createCore()
    const http = createHttpControlClient({
      baseUrl: 'http://host/agent-atelier',
      fetchImpl: bridge(core, async () => response),
      cwd: fixture.projectRoot,
    })
    const memory = createMemoryControlClient(core, {
      cwd: fixture.projectRoot,
      preview: async (agentName) => previewViewOf(response, agentName),
    })

    const [overHttp, overMemory] = await Promise.all([http.promptPreview('alpha'), memory.promptPreview('alpha')])

    expect(overHttp).toEqual(overMemory)
    expect(overHttp.degraded?.tier).toBe('static')
    // 骨架是空的：降级档不能伪造装配产物。
    expect(overHttp.segments.sources.every((group) => group.segments.length === 0)).toBe(true)
    expect(overHttp.segments.sources).toHaveLength(7)
  })

  it('memory 没注入读面时如实 503，不假装能预览', async () => {
    const memory = createMemoryControlClient(fixture.createCore(), { cwd: fixture.projectRoot })

    await expect(memory.promptPreview('alpha')).rejects.toMatchObject({ status: 503, code: 'unavailable' })
  })

  it('http 在读面没挂到宿主行时同样 503（两侧同一条约定）', async () => {
    const core = fixture.createCore()
    const http = createHttpControlClient({
      baseUrl: 'http://host/agent-atelier',
      fetchImpl: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        const result = await dispatchControlRequest({
          control: core,
          method: init?.method ?? 'GET',
          pathname: url.pathname,
          search: url.searchParams,
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          bodyText: typeof init?.body === 'string' ? init.body : null,
          signal: init?.signal ?? undefined,
          scanId: 1,
        })
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'content-type': 'application/json' },
        })
      },
      cwd: fixture.projectRoot,
    })

    await expect(http.promptPreview('alpha')).rejects.toMatchObject({ status: 503, code: 'unavailable' })
  })

  it('取消语义：已 abort 的 signal 不落到读面上', async () => {
    let called = 0
    const memory = createMemoryControlClient(fixture.createCore(), {
      cwd: fixture.projectRoot,
      preview: async (agentName) => { called += 1; return previewViewOf(fullResponse(), agentName) },
    })
    const controller = new AbortController()
    controller.abort()

    await expect(memory.promptPreview('alpha', { signal: controller.signal })).rejects.toThrow()
    expect(called).toBe(0)
  })

  it('previewViewOf 是纯搬移：不改写 degraded 与 notes 的原文', () => {
    const response = staticResponse()
    const view: PromptPreviewView = previewViewOf(response, 'alpha')

    expect(view.degraded).toEqual(response.degraded)
    expect(view.notes).toEqual(response.notes)
    expect(view.segments).toBe(response.segments)
  })
})
