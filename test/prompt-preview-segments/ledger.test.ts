/**
 * 票 84 第二片：注册侧账本。
 *
 * 账本的定义是「注册方自己记自己注册了什么」（规格 §3 / ADR-0009），所以它的
 * 记录范围恰好是**真的进了宿主注册表的那些节**：规划里 `executable: false` 的
 * 行没有注册动作，账本不该记它（否则投影要替它编一段）。
 *
 * 账本也不记 waterfall 改写与遮蔽：那是 `assemble()` 时刻的事实，注册时还不知道
 * （`sink.ts` 的注册早于任何一次装配）。缺席就是缺席，不猜。
 */
import { describe, expect, it } from 'vitest'

import {
  MODEL_SYSTEM_SECTION,
  PERSONA_PREFIX_SECTION,
  buildPromptSegments,
  createAssemblyService,
  createPromptLedger,
} from '../../src/assembly/index.ts'

import type { AgentAssembly } from '../../src/contract/index.ts'
import type { PromptLedger } from '../../src/assembly/index.ts'

/** 一行同时给出服务与它写入的账本（账本由持有方注入，见 AssemblyServiceOptions.ledger）。 */
function mounted(): { service: AgentAssembly; ledger: PromptLedger } {
  const ledger = createPromptLedger()
  return { service: createAssemblyService({ ledger }), ledger }
}

import type { AgentDefinition, AssemblyScope, AssemblySession, PromptSection } from '../../src/contract/index.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }

function session(overrides: Partial<AssemblySession> = {}): AssemblySession {
  return {
    agent: agentDefinition(),
    parameters: { route: ROUTE, persona: 'You review code.' },
    model: { modelName: 'chat', provider: 'deepseek', model: 'deepseek-chat', sysPrompt: 'Provider {{provider}}.', available: true, source: 'user-dsh' },
    ...overrides,
  }
}

function agentDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentName: 'atlas',
    name: 'Atlas',
    description: 'code reviewer',
    body: 'You review code.',
    source: 'project-dsh',
    origin: 'user',
    providerId: 'test',
    extra: {},
    path: '/fixtures/atlas/atlas.agent.md',
    ...overrides,
  }
}

/** 记账用的假 scope：按名字遮蔽、返回 disposer，行为与宿主 scoped registry 同构。 */
function fakeScope(): { scope: AssemblyScope; active: Map<string, PromptSection> } {
  const active = new Map<string, PromptSection>()
  return {
    active,
    scope: {
      systemPrompt: {
        section(section) {
          active.set(section.name, section)
          return () => {
            active.delete(section.name)
          }
        },
        getSectionOrder() {
          return 0
        },
      },
    },
  }
}

describe('createAssemblyService: 注册侧账本', () => {
  it('挂载后账本列出真正注册进宿主的节，二级键是宿主装配名', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    await service.registerAssemblySections({ scope, session: session() })

    expect(ledger.of(scope).map((entry) => entry.sectionName)).toEqual([
      MODEL_SYSTEM_SECTION,
      PERSONA_PREFIX_SECTION,
    ])
  })

  it('账本只记注册过的节：不可执行的规划行不在里面', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    await service.registerAssemblySections({ scope, session: session() })

    const names = ledger.of(scope).map((entry) => entry.sectionName)
    expect(names).not.toContain('atelier:skills')
    expect(names).not.toContain('channel:tools')
  })

  it('账本记注册时刻确知的 layer 与原文，但不记当时还看不到的事', async () => {
    /**
     * 分工（票 82 复审后收紧）：
     * - **注册时确知**的照记：`layer`（这份配置来自哪个文档）与 `registeredText`
     *   （本仓写下去的原文）——后者让读面能算出 waterfall 有没有改写。
     * - **注册时看不到**的不记：`rewrittenByWaterfall`（要等产物出来才能比）、
     *   `shadowedBy`（遮蔽关系在宿主侧）、`parts`（兼容模式丢弃扩展字段，
     *   本版没有数据源）。缺席就是「不知道」，不是「没有」。
     */
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    await service.registerAssemblySections({ scope, session: session() })

    const entries = ledger.of(scope)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      // 注册时确知：记了。
      expect(entry.layer, 'layer 在注册时刻可得，应记').toBeTruthy()
      expect(entry.registeredText, '注册原文应记（改写判定要用）').toBeTypeOf('string')
      // 注册时看不到：不记。
      expect(entry.rewrittenByWaterfall).toBeUndefined()
      expect(entry.shadowedBy).toBeUndefined()
      expect(entry.parts).toBeUndefined()
    }
  })

  it('规划名与宿主装配名不一致时才带 planName（一致时不重复记）', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    await service.registerAssemblySections({ scope, session: session() })

    for (const entry of ledger.of(scope)) {
      expect(entry.planName).toBeUndefined()
    }
  })

  it('没有挂载过的 scope 账本为空（不编造）', () => {
    const { ledger } = mounted()
    const { scope } = fakeScope()

    expect(ledger.of(scope)).toEqual([])
  })

  it('dispose 之后账本清空：注册没了，记录也不该留', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    const registration = await service.registerAssemblySections({ scope, session: session() })
    expect(ledger.of(scope).length).toBeGreaterThan(0)

    await registration.dispose()

    expect(ledger.of(scope)).toEqual([])
  })

  it('重新挂载后账本跟着新规划走（不是累加）', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    await service.registerAssemblySections({ scope, session: session() })
    const withModelRow = ledger.of(scope).length

    await service.registerAssemblySections({
      scope,
      session: session({ model: { modelName: 'chat', provider: 'deepseek', model: 'deepseek-chat', available: true, source: 'user-dsh' } }),
    })

    expect(ledger.of(scope).map((entry) => entry.sectionName)).toEqual([PERSONA_PREFIX_SECTION])
    expect(ledger.of(scope)).toHaveLength(withModelRow - 1)
  })

  it('账本把注册者身份记成本仓（persona 行虽用宿主名，注册者仍是本仓 sink）', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()

    await service.registerAssemblySections({ scope, session: session() })

    expect(ledger.of(scope).map((entry) => [entry.sectionName, entry.source])).toEqual([
      [MODEL_SYSTEM_SECTION, 'atelier-section'],
      [PERSONA_PREFIX_SECTION, 'atelier-section'],
    ])
  })

  it('注册失败时账本不留下半份记录', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()
    const failing: AssemblyScope = {
      systemPrompt: {
        section() {
          throw new Error('registry refused')
        },
        getSectionOrder() {
          return 0
        },
      },
    }

    await expect(service.registerAssemblySections({ scope: failing, session: session() })).rejects.toThrow('registry refused')
    expect(ledger.of(failing)).toEqual([])
    expect(ledger.of(scope)).toEqual([])
  })
})

describe('账本 → 分段投影（同层组合）', () => {
  it('账本记的节在产物里出现时，按账本来源归组而不是按名字猜', async () => {
    const { service, ledger } = mounted()
    const { scope } = fakeScope()
    await service.registerAssemblySections({ scope, session: session() })

    // 产物照宿主 assemble() 的形状手写：注册过的节以宿主装配名出现。
    const view = buildPromptSegments(
      {
        sections: [
          { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
          { name: MODEL_SYSTEM_SECTION, text: 'Provider deepseek.', interpolate: false },
          { name: PERSONA_PREFIX_SECTION, text: 'You review code.' },
        ],
        contexts: [],
        variables: {},
        tools: [],
      },
      ledger.of(scope),
    )

    expect(view.sources.find((group) => group.source === 'atelier-section')?.segments.map((segment) => segment.name))
      .toEqual([MODEL_SYSTEM_SECTION, PERSONA_PREFIX_SECTION])
    // persona 行按注册者归本仓，不再落进部署 persona 组——名字相同不代表注册者相同。
    expect(view.sources.find((group) => group.source === 'deployment-persona')?.segments).toEqual([])
    expect(view.sources.find((group) => group.source === 'harness-identity')?.segments.map((segment) => segment.name))
      .toEqual(['harness:identity'])
    expect(view.diagnostics).toEqual([])
  })
})
