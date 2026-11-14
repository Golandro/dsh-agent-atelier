import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { createAssemblyService } from '../src/agent-assembly/index.ts'
import {
  isDefaultBridge,
  missingRequiredTools,
  planSummonStart,
  readSummonArguments,
  summonRestriction,
} from '../src/control/index.ts'
import { DEFAULT_NATIVE_SUBAGENT_TOOLS, SUMMON_TOOL_NAME, applySummon } from '../src/dsh/host/summon.ts'

import type { ComposedAgentSession } from '../src/control/index.ts'
import type { AgentDefinition, PromptSection } from '../src/contract/index.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentName: 'atlas',
    name: 'Atlas',
    description: 'code reviewer',
    body: 'You review code.',
    modelOrder: ['smart'],
    source: 'project-dsh',
    origin: 'user',
    providerId: 'test',
    extra: {},
    path: '/fixtures/atlas/atlas.agent.md',
    ...overrides,
  }
}

function composed(overrides: Partial<ComposedAgentSession> = {}): ComposedAgentSession {
  const agent = overrides.agent ?? definition()
  return {
    ok: true,
    agent,
    model: overrides.model ?? {
      modelName: 'chat',
      provider: 'deepseek',
      model: 'deepseek-chat',
      sysPrompt: 'Provider {{provider}} runs {{model}}.',
      available: true,
      source: 'user-dsh',
    },
    parameters: overrides.parameters ?? {
      route: ROUTE,
      reasoningEffort: 'high',
      persona: agent.body,
      toolFilter: agent.requiredTools ?? [],
      flavor: 'spawn',
      effortSource: 'agent',
    },
    report: overrides.report ?? ({ selectedBy: 'alias', candidates: [] } as unknown as ComposedAgentSession['report']),
    ...overrides,
  }
}

function defaultComposed(): ComposedAgentSession {
  return composed({
    agent: definition({ agentName: 'default', name: '默认', body: '', modelOrder: ['dsh-default'], origin: 'built-in', source: 'bundled', providerId: 'bundled' }),
    parameters: {
      route: ROUTE,
      persona: '',
      toolFilter: [],
      flavor: 'spawn',
      effortSource: 'none',
    } as unknown as ComposedAgentSession['parameters'],
  })
}

describe('readSummonArguments', () => {
  it('accepts the documented shape and drops absent optionals', () => {
    expect(readSummonArguments({ agent: 'atlas', description: 'review this', prompt: 'do it' })).toEqual({
      agent: 'atlas',
      description: 'review this',
      prompt: 'do it',
    })
    expect(readSummonArguments({ agent: 'atlas', description: 'review', prompt: 'x', flavor: 'fork', cwd: 'src' })).toMatchObject({
      flavor: 'fork',
      cwd: 'src',
    })
  })

  it('rejects a missing required field, an unknown field, and a bad flavor', () => {
    expect(() => readSummonArguments({ agent: 'atlas', prompt: 'x' })).toThrow(/description/)
    expect(() => readSummonArguments({ agent: 'atlas', description: 'x', prompt: 'y', extra: 1 })).toThrow(/unknown argument/)
    expect(() => readSummonArguments({ agent: 'atlas', description: 'x', prompt: 'y', flavor: 'team' })).toThrow(/flavor/)
  })
})

describe('planSummonStart', () => {
  it('carries the resolved route and effort for a normal agent', () => {
    const plan = planSummonStart(composed(), { agentOptions: true, depthLimit: true }, 2)
    expect(plan).toMatchObject({
      provider: 'spawn',
      agentOptions: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      maxDepth: 2,
      warnings: [],
    })
  })

  it('leaves the default bridge without agentOptions so the provider inherits the parent route', () => {
    expect(isDefaultBridge(defaultComposed())).toBe(true)
    const plan = planSummonStart(defaultComposed(), { agentOptions: true, depthLimit: true }, undefined)
    expect(plan.agentOptions).toBeUndefined()
  })

  it('does not mistake a custom default, a persona or a raw model for the bridge', () => {
    expect(isDefaultBridge(composed())).toBe(false)
    expect(isDefaultBridge(composed({ agent: definition({ agentName: 'default', body: 'custom', modelOrder: ['smart'] }) }))).toBe(false)
  })

  it('degrades with warnings when the provider lacks agentOptions or depthLimit', () => {
    const noOptions = planSummonStart(composed(), { agentOptions: false, depthLimit: true }, 2)
    expect(noOptions.agentOptions).toBeUndefined()
    expect(noOptions.warnings[0]).toMatch(/does not support child agent options/)

    const noDepth = planSummonStart(composed(), { agentOptions: true, depthLimit: false }, 2)
    expect(noDepth.maxDepth).toBeUndefined()
    expect(noDepth.warnings[0]).toMatch(/cannot enforce maxDepth/)
  })
})

describe('summonRestriction', () => {
  const globals = new Set(['subagent', 'subagent_fork', 'summon_agent', 'read'])

  it('hides the native entries on a root agent unless the compatibility switch is on', () => {
    expect(summonRestriction({
      origin: undefined,
      keepNativeSubagentTools: false,
      globalToolNames: globals,
      nativeToolNames: DEFAULT_NATIVE_SUBAGENT_TOOLS,
      summonToolName: SUMMON_TOOL_NAME,
    })).toEqual({ deny: ['subagent', 'subagent_fork'] })
    expect(summonRestriction({
      origin: undefined,
      keepNativeSubagentTools: true,
      globalToolNames: globals,
      nativeToolNames: DEFAULT_NATIVE_SUBAGENT_TOOLS,
      summonToolName: SUMMON_TOOL_NAME,
    })).toBeUndefined()
  })

  it('also hides the summon entry itself on a delegated child', () => {
    expect(summonRestriction({
      origin: 'subagent',
      keepNativeSubagentTools: false,
      globalToolNames: globals,
      nativeToolNames: DEFAULT_NATIVE_SUBAGENT_TOOLS,
      summonToolName: SUMMON_TOOL_NAME,
    })).toEqual({ deny: ['subagent', 'subagent_fork', 'summon_agent'] })
    expect(summonRestriction({
      origin: 'subagent',
      keepNativeSubagentTools: true,
      globalToolNames: globals,
      nativeToolNames: DEFAULT_NATIVE_SUBAGENT_TOOLS,
      summonToolName: SUMMON_TOOL_NAME,
    })).toEqual({ deny: ['summon_agent'] })
  })

  it('ignores names the global registry does not have', () => {
    expect(summonRestriction({
      origin: undefined,
      keepNativeSubagentTools: false,
      globalToolNames: new Set(['read']),
      nativeToolNames: DEFAULT_NATIVE_SUBAGENT_TOOLS,
      summonToolName: SUMMON_TOOL_NAME,
    })).toBeUndefined()
  })
})

describe('missingRequiredTools', () => {
  it('lists only declared tools missing from the live surface', () => {
    const session = composed({ agent: definition({ requiredTools: ['read', 'grep', 'missing'] }) })
    expect(missingRequiredTools(session, new Set(['read', 'grep']))).toEqual(['missing'])
  })
})

function fakeSystemPrompt(active: Map<string, PromptSection>): { section(section: PromptSection): () => void; getSectionOrder(name: string): number } {
  return {
    section(section) {
      active.set(section.name, section)
      return () => { active.delete(section.name) }
    },
    getSectionOrder(name) {
      return name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : -1
    },
  }
}

/** The minimum a live Agent needs for the row: id, scoped ctx, durable header. */
function fakeAgent(id: string, origin: string | undefined, masks: unknown[], active: Map<string, PromptSection>): unknown {
  const restrict = vi.fn((mask: unknown) => { masks.push(mask); return () => {} })
  return {
    id,
    session: { header: { cwd: '/workspace', ...origin === undefined ? {} : { origin, delegationDepth: 1 } } },
    ctx: {
      systemPrompt: fakeSystemPrompt(active),
      tools: { restrict },
    },
  }
}

describe('applySummon integration', () => {
  async function mount(options: {
    readonly keepNative?: boolean
    readonly capabilities?: { agentOptions: boolean; depthLimit: boolean }
    readonly session?: ComposedAgentSession
    readonly composeError?: Error
  } = {}): Promise<{
    readonly ctx: Context
    readonly tool: { execute(args: unknown, exec: unknown): Promise<unknown> }
    readonly childMasks: unknown[]
    readonly rootMasks: unknown[]
    readonly childSections: Map<string, PromptSection>
    readonly starts: unknown[]
  }> {
    const ctx = new Context()
    const rootMasks: unknown[] = []
    const childMasks: unknown[] = []
    const childSections = new Map<string, PromptSection>()
    const starts: unknown[] = []
    let tool: { execute(args: unknown, exec: unknown): Promise<unknown> } | undefined
    const root = fakeAgent('root', undefined, rootMasks, new Map())
    const session = options.session ?? composed()
    const capabilities = options.capabilities ?? { agentOptions: true, depthLimit: true }

    ctx.provide('tools', {
      register(definition: unknown) {
        tool = definition as { execute(args: unknown, exec: unknown): Promise<unknown> }
        return () => {}
      },
      schemas(scope?: unknown) {
        if (scope !== undefined) return [{ name: 'read' }, { name: 'grep' }]
        return [{ name: 'subagent' }, { name: 'subagent_fork' }, { name: SUMMON_TOOL_NAME }, { name: 'read' }]
      },
    })
    ctx.provide('agents', { list: () => [root] })
    ctx.provide('subagents', {
      getProvider: () => ({ name: 'spawn', capabilities, prepareContinuable: () => ({}) }),
      resolveMaxDepth: () => 2,
      startActivation: async (spec: { readonly childId?: string }) => {
        starts.push(spec)
        const childId = spec.childId ?? 'external-child'
        const child = fakeAgent(childId, 'subagent', childMasks, childSections)
        await (ctx as unknown as { serial(...args: unknown[]): Promise<void> }).serial(ctx, 'agent/created', { agent: child })
        return { childId, result: Promise.resolve(undefined), dispose: async () => {} }
      },
    })
    ctx.provide('agentControl', {
      composeSession: async () => {
        if (options.composeError !== undefined) throw options.composeError
        return session
      },
    })
    ctx.provide('agentAssembly', createAssemblyService())
    ctx.provide('workingDirectory', { ensure: async () => '/workspace' })
    applySummon(ctx, { keepNativeSubagentTools: options.keepNative === true })

    // The injection callback must have fired before any assertion.
    await Promise.resolve()
    await Promise.resolve()
    if (tool === undefined) throw new Error('summon tool was not registered')
    return { ctx, tool, childMasks, rootMasks, childSections, starts }
  }

  it('hides the native entry points on the root agent', async () => {
    const mounted = await mount()
    expect(mounted.rootMasks).toEqual([{ deny: ['subagent', 'subagent_fork'] }])
  })

  it('starts the child with the resolved route and mounts its assembly sections before the first turn', async () => {
    const mounted = await mount()
    await mounted.tool.execute({ agent: 'atlas', description: 'review', prompt: 'read it' }, { agent: { id: 'root', session: { header: {} }, ctx: {} }, signal: new AbortController().signal })
    expect(mounted.starts).toHaveLength(1)
    expect(mounted.starts[0]).toMatchObject({
      provider: 'spawn',
      childId: expect.any(String),
      label: 'review',
      request: {
        prompt: [{ type: 'text', text: 'read it' }],
        agentOptions: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
        maxDepth: 2,
      },
      delivery: 'parent',
    })
    expect([...mounted.childSections.keys()]).toEqual(['atelier:model-sys', 'deployment:persona-prefix'])
    expect(mounted.childMasks).toEqual([{ deny: ['subagent', 'subagent_fork', 'summon_agent'] }])
  })

  it('honours keepNativeSubagentTools as a compatibility fallback', async () => {
    const mounted = await mount({ keepNative: true })
    expect(mounted.rootMasks).toEqual([])
    await mounted.tool.execute({ agent: 'atlas', description: 'review', prompt: 'read it' }, { agent: { id: 'root' }, signal: new AbortController().signal })
    expect(mounted.childMasks).toEqual([{ deny: ['summon_agent'] }])
  })

  it('omits agentOptions for the default bridge', async () => {
    const mounted = await mount({ session: defaultComposed() })
    await mounted.tool.execute({ agent: 'default', description: 'look', prompt: 'find it' }, { agent: { id: 'root' }, signal: new AbortController().signal })
    expect(mounted.starts[0]).not.toHaveProperty('agentOptions')
  })

  it('rejects the call and starts no child when the chain cannot be resolved', async () => {
    const mounted = await mount({ composeError: new Error('chain exhausted: smart -> fast') })
    await expect(
      mounted.tool.execute({ agent: 'atlas', description: 'review', prompt: 'x' }, { agent: { id: 'root' }, signal: new AbortController().signal }),
    ).rejects.toThrow(/chain exhausted: smart -> fast/)
    expect(mounted.starts).toEqual([])
  })
})
