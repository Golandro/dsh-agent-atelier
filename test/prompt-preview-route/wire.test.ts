/**
 * 票 83：读面在 wire 与契约层的形状（纯 fixture，不需要宿主包）。
 *
 * 这里管两件事：
 * 1. **线上 DTO 与装配侧镜像可互相赋值**——契约层不能 import 装配层，所以
 *    `src/contract/prompt-preview-route.ts` 自带一份结构；两份一旦漂移，客户端
 *    就会读到「看起来对、其实少字段」的数据。断言写在类型上，编译期就红。
 * 2. **wire 的既有约定**——新路由不是特例：marker / content-type / 400 / 404 /
 *    499 与其余六条一致，ui-host 行照常注册它。
 *
 * 真宿主装配（四档降级）在 `test/host-prompt-preview.test.ts`：那一份要挂真的
 * `SystemPrompt`/`ToolRuntime`，与其余 `host-*` 验收测试同属运行时孤岛。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import {
  AGENT_CONTROL_SERVICE,
  PROMPT_PREVIEW_SIDE_EFFECTS,
  PROMPT_PREVIEW_TIERS,
} from '../../src/contract/index.ts'
import { CLIENT_MARKER_HEADER, CONTROL_ROUTE_PATHS, dispatchControlRequest } from '../../src/dsh/host/wire.ts'
import { applyUiHost } from '../../src/dsh/host/ui-host.ts'
import { AGENT_LIVE_AGENTS_SERVICE, createLiveAgents } from '../../src/dsh/host/live-agents.ts'
import { createPromptPreview } from '../../src/dsh/host/prompt-preview.ts'
import { abortError, UnknownAgentError } from '../../src/control/index.ts'

import type {
  HostPromptAssembly,
  PromptSectionLedgerEntry,
} from '../../src/assembly/index.ts'
import type {
  PromptPreviewAssembly,
  PromptPreviewLedgerEntry,
  PromptPreviewResponse,
} from '../../src/contract/index.ts'
import type { PromptPreview, PromptPreviewRequest } from '../../src/dsh/host/prompt-preview.ts'

const SIGNAL = new AbortController().signal
const PATHNAME = '/agent-atelier/prompt-preview'
const JSON_HEADERS = { 'content-type': 'application/json', [CLIENT_MARKER_HEADER]: '1' }

/** 一份最小回答：wire 只负责搬运，不看里面的内容。 */
function response(): PromptPreviewResponse {
  return {
    cwd: null,
    scanId: 7,
    assembledAt: '2026-01-01T00:00:00.000Z',
    ledger: [],
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: [],
  }
}

function face(handler: (request: PromptPreviewRequest) => Promise<PromptPreviewResponse>): PromptPreview {
  return { preview: handler }
}

function dispatch(options: {
  readonly preview?: PromptPreview | undefined
  readonly headers?: Record<string, string>
  readonly body?: string | null
  readonly method?: string
  readonly pathname?: string
} = {}) {
  return dispatchControlRequest({
    control: { invalidate: () => {} } as never,
    method: options.method ?? 'POST',
    pathname: options.pathname ?? PATHNAME,
    search: new URLSearchParams(),
    headers: options.headers ?? JSON_HEADERS,
    bodyText: options.body === undefined ? JSON.stringify({ agentName: 'atlas' }) : options.body,
    signal: SIGNAL,
    scanId: 7,
    ...options.preview === undefined ? {} : { preview: options.preview },
  })
}

describe('prompt-preview 线上 DTO 与装配侧镜像', () => {
  it('可互相赋值：漂移会在编译期报错，不用等运行时', () => {
    const assemblyToDto = (host: HostPromptAssembly): PromptPreviewAssembly => host
    const assemblyToHost = (dto: PromptPreviewAssembly): HostPromptAssembly => dto
    const ledgerToDto = (entry: PromptSectionLedgerEntry): PromptPreviewLedgerEntry => entry
    const ledgerToHost = (entry: PromptPreviewLedgerEntry): PromptSectionLedgerEntry => entry

    expect([assemblyToDto, assemblyToHost, ledgerToDto, ledgerToHost].every((fn) => typeof fn === 'function')).toBe(true)
  })

  it('副作用声明同时点名 waterfall 与 handler：只读不等于无副作用', () => {
    const text = PROMPT_PREVIEW_SIDE_EFFECTS.join('\n')

    expect(text).toMatch(/waterfall/)
    expect(text).toMatch(/handler/)
    // 别把「只读」说成「无副作用」——这句必须在。
    expect(text).toMatch(/不是「无副作用」/)
  })

  it('三档降级各有稳定的机器可读名字', () => {
    expect([...PROMPT_PREVIEW_TIERS]).toEqual(['chain-exhausted', 'static', 'empty'])
  })
})

describe('prompt-preview 在 wire 上', () => {
  it('是固定路由之一，且只收 POST', async () => {
    expect([...CONTROL_ROUTE_PATHS]).toContain(PATHNAME)
    const wrongMethod = await dispatch({ method: 'GET' })

    expect(wrongMethod.status).toBe(405)
  })

  it('保留 mutation 的两道栅栏（marker + content-type）', async () => {
    const noMarker = await dispatch({ headers: { 'content-type': 'application/json' } })
    expect(noMarker.status).toBe(403)

    const noContentType = await dispatch({ headers: { [CLIENT_MARKER_HEADER]: '1' } })
    expect(noContentType.status).toBe(415)
  })

  it('把坏 agentName 与坏 body 判成 400，把未知 agent 判成 404', async () => {
    expect((await dispatch({ body: JSON.stringify({ agentName: 'a/b' }) })).status).toBe(400)
    expect((await dispatch({ body: 'not json' })).status).toBe(400)
    expect((await dispatch({ body: JSON.stringify({ agentName: '' }) })).status).toBe(400)

    const unknown = await dispatch({
      preview: face(async () => { throw new UnknownAgentError('ghost') }),
    })
    expect(unknown.status).toBe(404)
    expect((unknown.body as { error: { code: string } }).error.code).toBe('not-found')
  })

  it('透传 cwd：畸形的 cwd 退成 null（软边界），非字符串才是 400', async () => {
    let seen: PromptPreviewRequest | undefined
    const preview = face(async (request) => {
      seen = request
      return response()
    })

    const relative = await dispatch({ preview, body: JSON.stringify({ agentName: 'atlas', cwd: 'relative/path' }) })
    expect(relative.status).toBe(200)
    expect(seen?.cwd).toBeNull()

    const numeric = await dispatch({ preview, body: JSON.stringify({ agentName: 'atlas', cwd: 42 }) })
    expect(numeric.status).toBe(400)
  })

  it('把读面的回答原样交出去，scanId 用本次请求的令牌', async () => {
    const result = await dispatch({ preview: face(async () => response()) })

    expect(result.status).toBe(200)
    expect((result.body as PromptPreviewResponse).scanId).toBe(7)
    expect((result.body as PromptPreviewResponse).cwd).toBeNull()
  })

  it('取消原样冒出：wire 记 499，不折成降级', async () => {
    const result = await dispatch({ preview: face(async () => { throw abortError() }) })

    expect(result.status).toBe(499)
    expect((result.body as { error: { code: string } }).error.code).toBe('aborted')
  })

  it('没挂读面时说不可用，而不是假装成功', async () => {
    const result = await dispatch()

    expect(result.status).toBe(503)
    expect((result.body as { error: { code: string } }).error.code).toBe('unavailable')
  })
})

describe('prompt-preview 在 ui-host 行上', () => {
  it('和其余控制路由一起注册，一个不多一个不少', () => {
    const ctx = new Context()
    const routes: string[] = []
    ctx.provide(AGENT_CONTROL_SERVICE, {})
    ctx.provide('webServer', {
      register(route: { path: string }) {
        routes.push(route.path)
        return () => {}
      },
    })

    applyUiHost(ctx)

    expect(routes).toContain(PATHNAME)
    expect([...routes].sort()).toEqual([...CONTROL_ROUTE_PATHS].sort())
  })
})

describe('prompt-preview 的装配收尾', () => {
  /** 一个够用的活 agent：ctx 只要能按名字取服务，model 只要能报当前选择。 */
  function fakeAgent(services: Record<string, unknown>) {
    return {
      id: 'fake',
      ctx: { get: (name: string) => services[name] },
      model: { current: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    }
  }

  function mountFake(services: Record<string, unknown>) {
    const ctx = new Context()
    ctx.provide(AGENT_CONTROL_SERVICE, {
      composeSession: async () => ({
        ok: true,
        agent: { agentName: 'atlas', name: 'Atlas', description: '', body: 'p', source: 'project-dsh', origin: 'user', providerId: 't', extra: {}, path: '/p' },
        parameters: { route: { provider: 'deepseek', model: 'deepseek-chat' }, persona: 'p', toolFilter: [], flavor: 'spawn', effortSource: 'agent' },
        report: { aliasChain: [], rawFallbackUsed: false, candidates: [], selectedBy: 'raw', effortSource: 'agent' },
      }),
    })
    const live = createLiveAgents()
    live.record('atlas', fakeAgent(services) as never)
    ctx.provide(AGENT_LIVE_AGENTS_SERVICE, live)
    return createPromptPreview(ctx)
  }

  it('装配抛错时仍然 dispose 掉 ResolvedToolSet：不留半装配状态', async () => {
    let disposed = 0
    const preview = mountFake({
      tools: { resolve: async () => ({ dispose: () => { disposed += 1 } }) },
      systemPrompt: { assemble: async () => { throw new Error('assemble failed') } },
    })

    const response = await preview.preview({ agentName: 'atlas', cwd: null, scanId: 1, signal: SIGNAL })

    expect(response.degraded?.tier).toBe('static')
    expect(disposed).toBe(1)
  })

  it('装配成功也 dispose：工具集合不跨请求泄漏', async () => {
    let disposed = 0
    const preview = mountFake({
      tools: { resolve: async () => ({ dispose: () => { disposed += 1 } }) },
      systemPrompt: {
        assemble: async () => ({ sections: [{ name: 'harness:identity', text: 'You are…' }], contexts: [], variables: {}, tools: [] }),
      },
    })

    const response = await preview.preview({ agentName: 'atlas', cwd: null, scanId: 1, signal: SIGNAL })

    expect(response.degraded).toBeUndefined()
    expect(disposed).toBe(1)
  })

  it('把 signal 原样交给 tools.resolve 与 assemble', async () => {
    const seen: AbortSignal[] = []
    const preview = mountFake({
      tools: { resolve: async (context: { signal: AbortSignal }) => { seen.push(context.signal); return { dispose: () => {} } } },
      systemPrompt: {
        assemble: async (context: { signal: AbortSignal }) => {
          seen.push(context.signal)
          return { sections: [], contexts: [], variables: {}, tools: [] }
        },
      },
    })
    const controller = new AbortController()

    await preview.preview({ agentName: 'atlas', cwd: null, scanId: 1, signal: controller.signal })

    expect(seen).toEqual([controller.signal, controller.signal])
  })
})

