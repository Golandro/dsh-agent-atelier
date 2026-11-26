/**
 * 票 83 验收：宿主读面 `POST /agent-atelier/prompt-preview` 的四档降级。
 *
 * 规格 §5 的四档在这里各有一条用例：① 完整装配、② 链耗尽、③ 静态回退、
 * ④ registry 读不到。另加两条结构事实：副作用声明进返回值，以及 abort 透传。
 *
 * fixture 用真的 `SystemPrompt` + `ToolRuntime` + native executor 与真的注册
 * sink；桩只有两处——`agentControl`（别的票的面）与活 agent 表（正是本票要读
 * 的那张表）。最后一组用真 `AgentLoop` + 真 `summon_agent` 跑通一次，那是票
 * 83 的验收条件：返回的 `sections` 同时含宿主节与 atelier 节。
 *
 * 与其余 `host-*` 验收测试一样，这一份在 tsc 之外（`tsconfig.json` 的 exclude）：
 * 真宿主包会把自己的事件类型补进 Cordis，与本 bundle 自持的结构镜像相冲突。
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

import { createAssemblyService, createPromptLedger, planAssembly } from '../src/assembly/index.ts'
import { PROMPT_LEDGER_SERVICE, applyAssembly } from '../src/dsh/host/assembly.ts'
import { AGENT_LIVE_AGENTS_SERVICE, createLiveAgents } from '../src/dsh/host/live-agents.ts'
import { createPromptPreview } from '../src/dsh/host/prompt-preview.ts'
import { applySummon } from '../src/dsh/host/summon.ts'
import { AGENT_CONTROL_SERVICE } from '../src/contract/index.ts'
import { ChainExhaustedError, UnknownAgentError } from '../src/control/index.ts'

import type { AgentAssembly, AssemblyScope } from '../src/contract/index.ts'
import type { ComposedAgentSession } from '../src/control/index.ts'
import type { PromptPreviewResponse } from '../src/contract/index.ts'
import type { PromptSectionLedgerEntry } from '../src/assembly/index.ts'

const SIGNAL = new AbortController().signal
const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }

function definition(agentName = 'atlas') {
  return {
    agentName,
    name: 'Atlas',
    description: 'code reviewer',
    body: 'You review code.',
    modelOrder: ['smart'],
    source: 'project-dsh' as const,
    origin: 'user' as const,
    providerId: 'test',
    extra: {},
    path: '/fixtures/atlas/atlas.agent.md',
  }
}

/** One composed session, as `composeSession` would answer it. */
function composed(agentName = 'atlas'): ComposedAgentSession {
  return {
    ok: true,
    agent: definition(agentName),
    parameters: {
      route: ROUTE,
      reasoningEffort: 'high',
      persona: 'You review code.',
      toolFilter: [],
      flavor: 'spawn',
      effortSource: 'agent',
    },
    report: { aliasChain: [], rawFallbackUsed: false, candidates: [], selectedBy: 'raw', effortSource: 'agent' },
    model: {
      modelName: 'ds-chat',
      provider: ROUTE.provider,
      model: ROUTE.model,
      sysPrompt: 'Provider {{provider}} runs {{model}}.',
      available: true,
      source: 'project-dsh' as const,
    },
  }
}

interface HostAgentFixture {
  id: string
  ctx: Context
  model: { current: () => Readonly<typeof ROUTE> | undefined }
}

interface Mounted {
  readonly ctx: Context
  readonly agent: HostAgentFixture
  readonly assembly: AgentAssembly
}

/**
 * Mount the real host prompt face for one agent scope, with this bundle's sink
 * registered into it.
 */
async function mountHost(options: { readonly withAgent?: boolean; readonly withModel?: boolean } = {}): Promise<Mounted> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)

  // The production path tags the scope with the Agent object itself
  // (`assembleContextFor` → `scope: agent`), so the fixture does too: a
  // separate key object would route the waterfall to a scope the sink never
  // registered into, and the atelier sections would silently disappear.
  const agent: HostAgentFixture = {
    id: 'atlas-agent',
    ctx: undefined as unknown as Context,
    model: { current: () => options.withModel === false ? undefined : ROUTE },
  }
  let scoped: Context | undefined
  const row = ctx.plugin(Object.assign(
    (inner: Context) => { scoped = createScope(inner, agent).ctx },
    { inject: ['tools', 'systemPrompt'] },
  ))
  await row.await()
  if (scoped === undefined) throw new Error('the scope row did not activate')
  agent.ctx = scoped

  ctx.provide(PROMPT_LEDGER_SERVICE, createPromptLedger())
  const live = createLiveAgents()
  ctx.provide(AGENT_LIVE_AGENTS_SERVICE, live)
  if (options.withAgent !== false) live.record('atlas', agent)

  // A real sink, writing into the same ledger the read face reads.
  const assembly = createAssemblyService({ ledger: ctx.get(PROMPT_LEDGER_SERVICE) as never })
  await assembly.registerAssemblySections({
    scope: scoped as unknown as AssemblyScope,
    session: composed() as never,
  })
  return { ctx, agent, assembly }
}

/** The control face the route reads; each case decides how it answers. */
function controlOf(composeSession: () => Promise<ComposedAgentSession>) {
  return { composeSession }
}

function previewOf(ctx: Context) {
  return createPromptPreview(ctx)
}

function preview(mounted: Mounted, agentName = 'atlas', signal?: AbortSignal): Promise<PromptPreviewResponse> {
  return previewOf(mounted.ctx).preview({ agentName, cwd: null, scanId: 3, signal: signal ?? SIGNAL })
}

describe('prompt-preview ①：宿主面可用 + agent 可解析', () => {
  it('返回真宿主装配，含宿主节与 atelier 节，并带上注册侧账本', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const response = await preview(mounted)

    expect(response.degraded).toBeUndefined()
    const names = response.assembly?.sections.map((section: { name: string }) => section.name) ?? []
    expect(names).toContain('harness:identity')
    expect(names).toContain('atelier:model-sys')
    expect(response.ledger.map((entry: PromptSectionLedgerEntry) => entry.sectionName)).toContain('atelier:model-sys')
    expect(response.assembly?.tools).toEqual([])
    expect(response.cwd).toBeNull()
    expect(response.scanId).toBe(3)
    expect(response.plan?.sections.length).toBeGreaterThan(0)
  })

  it('① 档带上已投影的分段：投影在宿主侧发生，chunk 拿到的就是成品', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const response = await preview(mounted)

    // 段视图必须有：浏览器 chunk 读不到装配层，投影只能在这里做。
    expect(response.segments).toBeDefined()
    const segments = response.segments!
    // 7 条来源固定顺序，空组也保留（与契约的 PROMPT_SOURCE_ORDER 同口径）。
    expect(segments.sources.map((group) => group.source)).toEqual([
      'harness-identity',
      'deployment-persona',
      'preset-persona',
      'atelier-section',
      'tool-guidance',
      'runtime-context',
      'tool-declaration',
    ])
    // 真宿主节与 atelier 节都进了各自的组——不是一份空壳投影。
    const bySource = new Map(segments.sources.map((group) => [group.source, group.segments]))
    expect(bySource.get('harness-identity')?.map((s) => s.name)).toContain('harness:identity')
    expect(bySource.get('atelier-section')?.map((s) => s.name)).toContain('atelier:model-sys')
    // 账本条目带出的标注落到了对应段上（注册者自己记的，不是从产物反推）。
    const atelier = bySource.get('atelier-section')?.find((s) => s.name === 'atelier:model-sys')
    expect(atelier?.source).toBe('atelier-section')
  })

  it('① 档的 context provider 拿得到 context.agent：文本非空，投影后也非空', async () => {
    /**
     * 这条守卫钉的是一个真实缺陷的回归面：宿主侧 provider 与 waterfall handler
     * 都判 `context.agent === undefined` 就跳过自己（先例：
     * `packages/session/working-directory/src/index.ts` 的 provider 直接回空串、
     * handler 直接 `return next()`）。读面若不传 `agent`，⑥ 组拿到的会是**空文本**
     * ——不是「这次没贡献」，是本仓没把宿主需要的东西递过去。
     *
     * 现有用例此前完全没断言 contexts，所以这个缺陷一路漏到 review。
     *
     * 测试台只挂了 SystemPrompt + tools（没有 working-directory 插件），所以这里
     * 自己注册一个**同形** provider：只有拿到 `context.agent` 才产出文本。这样断言
     * 的是读面有没有传 agent，而不是某个宿主插件在不在场。
     */
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const seen: unknown[] = []
    const scope = mounted.agent.ctx as unknown as { systemPrompt: { context(entry: unknown): () => void } }
    scope.systemPrompt.context({
      name: 'test:agent-aware-context',
      order: 900,
      interpolate: false,
      // 与 working-directory 同形：拿不到 agent 就回空串。
      text: (context: { agent?: unknown }) => {
        seen.push(context.agent)
        return context.agent === undefined ? '' : 'cwd=/work/atlas'
      },
    })

    const response = await preview(mounted)

    // provider 真的被调用了，且拿到的是那个真实 Agent（不是 undefined、不是别的对象）。
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toBe(mounted.agent)

    const entry = response.assembly?.contexts.find((item) => item.name === 'test:agent-aware-context')
    expect(entry, '读面没把 provider 的 context 带回来').toBeDefined()
    expect(entry?.text, 'context provider 没拿到 context.agent，回了空串').toBe('cwd=/work/atlas')

    // 投影后的 ⑥ 组同样非空——投影不该丢掉内容。
    const runtimeContext = response.segments.sources.find((group) => group.source === 'runtime-context')
    const segment = runtimeContext?.segments.find((item) => item.name === 'test:agent-aware-context')
    expect(segment?.text).toBe('cwd=/work/atlas')
  })

  it('把副作用写进返回值，而不是只写在文档里', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const response = await preview(mounted)

    expect(response.sideEffects.join(' ')).toMatch(/waterfall/)
    expect(response.sideEffects.join(' ')).toMatch(/handler/)
  })
})

describe('prompt-preview ②：链耗尽', () => {
  it('把链解析报告当数据带出，且不跑装配', async () => {
    const mounted = await mountHost()
    const failure = new ChainExhaustedError({
      ok: false,
      code: 'chain-exhausted',
      message: 'chain exhausted: smart -> fast',
      report: {
        aliasChain: [{ orderIndex: 0, alias: 'smart', targets: ['ds-chat'], skipped: 'unknown-alias' }],
        rawFallbackUsed: false,
        candidates: [],
        selectedBy: 'none',
        effortSource: 'none',
      },
    }, false)
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => { throw failure }))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('chain-exhausted')
    expect(response.degraded?.reason).toContain('chain exhausted')
    expect(response.degraded?.report?.selectedBy).toBe('none')
    expect(response.degraded?.report?.aliasChain[0]?.skipped).toBe('unknown-alias')
    expect(response.assembly).toBeUndefined()
    expect(response.ledger).toEqual([])
    expect(response.sideEffects.length).toBeGreaterThan(0)
  })
})

describe('prompt-preview ③：宿主面不可用', () => {
  it('退到静态规划，并逐项列出缺什么', async () => {
    const mounted = await mountHost({ withAgent: false })
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('static')
    // 本仓 AssemblyPlan 不依赖宿主，仍然给。
    expect(response.plan?.sections.map((row) => row.name)).toEqual(planAssembly(composed() as never).sections.map((row) => row.name))
    expect(response.degraded?.missing.map((item: { item: string }) => item.item)).toContain('live-agent')
    expect(response.assembly).toBeUndefined()
    expect(response.sideEffects.length).toBeGreaterThan(0)
  })

  it('waterfall handler 抛错时降级，而不是冒 500', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    // 一个真实的 waterfall 监听器：装配时抛错。
    mounted.ctx.on('system-prompt/assemble', () => { throw new Error('handler exploded') })

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('static')
    expect(response.degraded?.reason).toContain('handler exploded')
    expect(response.degraded?.missing.map((item: { item: string }) => item.item)).toContain('host-assembly')
  })

  it('agent 没有模型选择时降级，而不是替它编一个', async () => {
    const mounted = await mountHost({ withModel: false })
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('static')
    expect(response.degraded?.missing.map((item: { item: string }) => item.item)).toContain('model-selection')
  })
})

describe('prompt-preview ④：registry 读不到', () => {
  it('回空态 + 错误，绝不是 500', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => { throw new Error('registry is unreadable') }))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('empty')
    expect(response.degraded?.reason).toContain('registry is unreadable')
    expect(response.assembly).toBeUndefined()
    expect(response.plan).toBeUndefined()
  })

  it('未知 agent 不降级：它按 wire 的既有约定走 404', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => { throw new UnknownAgentError('ghost') }))

    await expect(preview(mounted, 'ghost')).rejects.toBeInstanceOf(UnknownAgentError)
  })
})

describe('prompt-preview 取消语义', () => {
  it('已 abort 的 signal 原样冒出，不留半装配状态', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    const controller = new AbortController()
    controller.abort()

    await expect(preview(mounted, 'atlas', controller.signal)).rejects.toThrow()
  })
})

describe('prompt-preview 在真 agent 上跑通一次（票 83 验收）', () => {
  it('走真实 AgentLoop + 真 summon，返回的 sections 同时含宿主节与 atelier 节', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    const sessionRoot = await mkdtemp(join(tmpdir(), 'atelier-preview-'))
    onTestFinished(async () => { await rm(sessionRoot, { recursive: true, force: true }) })
    await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot })
    const harness = await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(Object.assign(
      (inner: Context) => {
        inner.subagents.registerProvider({
          name: 'spawn',
          inheritsParentContext: false,
          capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true },
          prepareContinuable: async () => ({}),
        } as never)
      },
      { inject: ['subagents'] },
    ))

    ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    // 装配行与它自己的账本：读面必须拿到 sink 写入的同一份实例。
    const assemblyRow = ctx.plugin({ apply: (inner: Context) => applyAssembly(inner, {}) })
    await assemblyRow.await()
    const summonRow = ctx.plugin({ apply: (inner: Context) => applySummon(inner, {}) })
    await summonRow.await()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const root = await harness.create(SessionId('root-1'), { provider: ROUTE.provider, model: ROUTE.model } as never)
    const result = await executeModelToolFixture(ctx, {
      callId: ToolCallId('call-1'),
      name: 'summon_agent',
      arguments: { agent: 'atlas', description: 'review', prompt: 'read it' },
      signal: SIGNAL,
      agent: root as never,
    })
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true)

    const response = await previewOf(ctx).preview({ agentName: 'atlas', cwd: null, scanId: 11, signal: SIGNAL })

    expect(response.degraded).toBeUndefined()
    const names = response.assembly?.sections.map((section: { name: string }) => section.name) ?? []
    // 宿主节：SystemPrompt 自己的 identity。
    expect(names).toContain('harness:identity')
    // atelier 节：本仓 sink 在同一个 scope 里真的注册进去的那一行。
    expect(names).toContain('atelier:model-sys')
    // 账本与产物对得上：注册侧记的正是产物里那一节。
    expect(response.ledger.map((entry: PromptSectionLedgerEntry) => entry.sectionName)).toContain('atelier:model-sys')
    expect(response.plan?.sections.length).toBeGreaterThan(0)
    expect(response.sideEffects.join(' ')).toMatch(/waterfall/)
  })
})

describe('降级档不伪造分段（②③④ 装配没发生，骨架必须是空的）', () => {
  /**
   * 这条守卫钉的是「不撒谎」。信封的 `segments` 形状恒定（消费方按它总是存在写），
   * 但降级档给的是**空骨架**：7 条来源、组内无段。它与档位 ① 的「真装配了但这次
   * 都没贡献」在数据上都是 0 段，区别只由 `degraded` 的在场表达——UI 的口径是
   * 「降级档不摆来源组」，所以空骨架不会被渲染成 7 个空组。
   *
   * 这里同时钉住「骨架真的空」：若哪天有人给降级档塞了段，那就是伪造装配产物。
   */
  const expectEmptySkeleton = (segments: PromptPreviewResponse['segments']): void => {
    expect(segments.sources).toHaveLength(7)
    expect(segments.sources.every((group) => group.segments.length === 0)).toBe(true)
    expect(segments.unattributed).toEqual([])
    expect(segments.diagnostics).toEqual([])
  }

  it('② 链耗尽：空骨架 + degraded', async () => {
    const mounted = await mountHost()
    const failure = new ChainExhaustedError({
      ok: false,
      code: 'chain-exhausted',
      message: 'chain exhausted: smart -> fast',
      report: { aliasChain: [], rawFallbackUsed: false, candidates: [], selectedBy: 'none', effortSource: 'none' },
    }, false)
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => { throw failure }))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('chain-exhausted')
    expectEmptySkeleton(response.segments)
  })

  it('③ 静态回退：空骨架 + degraded', async () => {
    const mounted = await mountHost({ withAgent: false })
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('static')
    expectEmptySkeleton(response.segments)
  })

  it('④ 空态：空骨架 + degraded', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => { throw new Error('registry 读不到：ENOENT registry.yaml') }))

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('empty')
    expectEmptySkeleton(response.segments)
  })
})

describe('③ 预设遮蔽：读面观测到 preset 在 compose 时如实标注', () => {
  /**
   * 预设与部署级 persona 在产物里同名同形，光看产物分不出谁遮蔽了谁。宿主读面能
   * 多知道一件事：这个 Agent 的 scope 上有没有 preset 在 compose。这条测试钉住
   * 「观测到就标、没观测到就不标」——两边都不猜。
   */
  it('有 preset 在 compose：deployment:persona-* 带 opaque 遮蔽标注', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    mounted.ctx.provide('agentPresets', { composedPreset: () => 'planner' })

    const response = await preview(mounted)

    const persona = response.segments.sources
      .find((group) => group.source === 'deployment-persona')
      ?.segments ?? []
    expect(persona.length).toBeGreaterThan(0)
    for (const segment of persona) {
      // opaque = 「被遮蔽了，但遮蔽者长什么样我们看不见」——不编一个遮蔽者。
      expect(segment.shadowedBy).toEqual({ visibility: 'opaque' })
    }
  })

  it('没有 preset 在 compose：不标遮蔽（没观测到 ≠ 没发生）', async () => {
    const mounted = await mountHost()
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    mounted.ctx.provide('agentPresets', { composedPreset: () => undefined })

    const response = await preview(mounted)

    const persona = response.segments.sources
      .find((group) => group.source === 'deployment-persona')
      ?.segments ?? []
    for (const segment of persona) {
      expect(segment.shadowedBy).toBeUndefined()
    }
  })
})

describe('prompt-preview ③ 的有效 config 口径', () => {
  it('只认 fiber.effectiveConfig：未求值的 options.config 不算生效值', async () => {
    const mounted = await mountHost({ withAgent: false })
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    // 一个真实的 loader 形状：一行 system-prompt，fiber 还没激活。
    mounted.ctx.provide('loader', {
      *entries() {
        yield { options: { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { personaPrefix: '!!js raw' } } }
      },
    })

    const response = await preview(mounted)

    expect(response.degraded?.tier).toBe('static')
    // 宁可缺，不可假：没有 effectiveConfig 就不给 staticConfig。
    expect(response.staticConfig).toBeUndefined()
    expect(response.degraded?.missing.map((item: { item: string }) => item.item)).toContain('host-config')
    expect(JSON.stringify(response)).not.toContain('!!js raw')
  })

  it('有 effectiveConfig 时给出来，并且只挑 system-prompt 那一行', async () => {
    const mounted = await mountHost({ withAgent: false })
    mounted.ctx.provide(AGENT_CONTROL_SERVICE, controlOf(async () => composed()))
    mounted.ctx.provide('loader', {
      *entries() {
        yield { options: { id: 'other', name: 'some-other-plugin' }, fiber: { effectiveConfig: { ignored: true } } }
        yield {
          options: { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
          fiber: { effectiveConfig: { personaPrefix: 'You are the deployment persona.' } },
        }
      },
    })

    const response = await preview(mounted)

    expect(response.staticConfig).toHaveLength(1)
    expect(response.staticConfig?.[0]?.id).toBe('system-prompt')
    expect(response.staticConfig?.[0]?.config).toEqual({ personaPrefix: 'You are the deployment persona.' })
    expect(response.degraded?.missing.map((item: { item: string }) => item.item)).not.toContain('host-config')
  })
})
