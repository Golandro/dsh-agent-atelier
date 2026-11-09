/**
 * Ticket 07 acceptance, in process: the real tool registry and executor with
 * this bundle's summon row. The prompt side is covered by the sibling test.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'

import { createAssemblyService } from '../src/agent-assembly/index.ts'
import { applySummon } from '../src/dsh/host/summon.ts'
import { mintScope, ownContext } from './support/host.ts'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { ComposedAgentSession } from '../src/contract/index.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }
const SIGNAL = new AbortController().signal

interface Mounted {
  readonly ctx: Context
  readonly agent: Agent
  readonly row: { dispose(): Promise<void> }
  readonly starts: unknown[]
  readonly composeError?: Error
}

function composed(persona = 'You review code.'): ComposedAgentSession {
  const agent = {
    agentName: 'atlas',
    name: 'Atlas',
    description: 'code reviewer',
    body: persona,
    modelOrder: ['smart'],
    source: 'project-dsh' as const,
    origin: 'user' as const,
    providerId: 'test',
    extra: {},
    path: '/fixtures/atlas/atlas.agent.md',
  }
  return {
    ok: true,
    agent,
    parameters: {
      route: ROUTE,
      reasoningEffort: 'high',
      persona,
      toolFilter: [],
      flavor: 'spawn',
      effortSource: 'agent',
    },
    report: { selectedBy: 'raw', candidates: [] } as unknown as ComposedAgentSession['report'],
  }
}

function nativeTool(name: string): ReturnType<typeof defineTool> {
  return defineTool({
    name,
    description: 'native delegation entry used by the fixture',
    parameters: { prompt: { type: 'string' } },
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: false },
      render: () => [{ type: 'text', text: 'native' }],
    },
    async execute() {
      return {}
    },
  })
}

async function mount(options: {
  readonly keepNative?: boolean | undefined
  readonly composeError?: Error | undefined
  readonly external?: boolean | undefined
} = {}): Promise<Mounted> {
  const ctx = ownContext(new Context())
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  ctx.tools.register(nativeTool('subagent'))
  ctx.tools.register(nativeTool('subagent_fork'))

  const agent = { id: 'root', session: { header: { cwd: '/workspace' } } } as unknown as Agent
  const scope: Scope = await mintScope(ctx, agent, ['tools', 'systemPrompt'])
  ;(agent as unknown as { ctx: Context }).ctx = scope.ctx

  const starts: unknown[] = []
  ctx.provide('agents', { list: () => [agent] })
  ctx.provide('subagents', {
    getProvider: () => ({
      name: 'spawn',
      capabilities: { agentOptions: true, depthLimit: true },
      ...options.external === true ? {} : { prepareContinuable: () => ({}) },
    }),
    resolveMaxDepth: () => undefined,
    startActivation: async (spec: { childId?: string }) => {
      starts.push(spec)
      const childId = spec.childId ?? 'external-child'
      return { childId, result: Promise.resolve(undefined), dispose: async () => {} }
    },
  })
  ctx.provide('agentControl', {
    composeSession: async () => {
      if (options.composeError !== undefined) throw options.composeError
      return composed()
    },
  })
  ctx.provide('agentAssembly', createAssemblyService())
  ctx.provide('workingDirectory', { ensure: async () => '/workspace' })

  const row = ctx.plugin({ apply: (inner: Context) => applySummon(inner, { keepNativeSubagentTools: options.keepNative === true }) })
  await row.await()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ctx, agent, row, starts, ...options.composeError === undefined ? {} : { composeError: options.composeError } }
}

function surface(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map((schema) => schema.name)
}

async function call(ctx: Context, agent: Agent, argumentsValue: unknown) {
  return executeModelToolFixture(ctx, {
    callId: ToolCallId('call-1'),
    name: 'summon_agent',
    arguments: argumentsValue,
    signal: SIGNAL,
    agent,
  })
}

describe('real tool registry + summon row', () => {
  it('hides the native entries from the Agent surface but not from the global view', async () => {
    const { ctx, agent } = await mount()
    expect(surface(ctx, agent)).toEqual(['summon_agent'])
    expect(ctx.tools.schemas().map((schema) => schema.name)).toEqual(['subagent', 'subagent_fork', 'summon_agent'])
  })

  it('lifts the mask when the row unloads, and keeps it off after a keepNative remount', async () => {
    const { ctx, agent, row } = await mount()
    await row.dispose()
    await Promise.resolve()
    expect(surface(ctx, agent)).toEqual(['subagent', 'subagent_fork'])

    const again = ctx.plugin({ apply: (inner: Context) => applySummon(inner, { keepNativeSubagentTools: true }) })
    await again.await()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(surface(ctx, agent)).toEqual(['subagent', 'subagent_fork', 'summon_agent'])
  })

  it('honours keepNativeSubagentTools on a fresh mount', async () => {
    const { ctx, agent } = await mount({ keepNative: true })
    expect(surface(ctx, agent)).toEqual(['subagent', 'subagent_fork', 'summon_agent'])
  })

  it('starts the child with the composed route, label and prompt', async () => {
    const { ctx, agent, starts } = await mount()
    const result = await call(ctx, agent, { agent: 'atlas', description: 'review', prompt: 'read it' })
    expect(result.isError).not.toBe(true)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      provider: 'spawn',
      label: 'review',
      request: {
        prompt: [{ type: 'text', text: 'read it' }],
        agentOptions: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      },
    })
  })

  it('starts an external provider without a reserved child id', async () => {
    const { ctx, agent, starts } = await mount({ external: true })
    const result = await call(ctx, agent, { agent: 'atlas', description: 'review', prompt: 'read it' })
    expect(result.isError).not.toBe(true)
    expect(starts).toHaveLength(1)
    expect(starts[0]).not.toHaveProperty('childId')
    expect(starts[0]).toMatchObject({ provider: 'spawn', label: 'review', request: { prompt: [{ type: 'text', text: 'read it' }] } })
  })

  it('turns a chain-exhausted start into an isError result with no child', async () => {
    const { ctx, agent, starts } = await mount({ composeError: new Error('chain exhausted: smart -> fast') })
    const result = await call(ctx, agent, { agent: 'atlas', description: 'review', prompt: 'x' })
    expect(result.isError).toBe(true)
    expect(starts).toEqual([])
    const text = result.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    expect(text).toContain('chain exhausted: smart -> fast')
  })
})
