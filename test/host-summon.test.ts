/**
 * Ticket 07 tier-2 acceptance, in process: real AgentLoop + real subagent
 * service with a local (continuable) provider. The provider never sees the
 * child; the test observes it on agent/created, after the summon row mounted
 * its assembly and mask.
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

import { createAssemblyService } from '../src/agent-assembly/index.ts'
import { applySummon } from '../src/dsh/host/summon.ts'
import { ownContext } from './support/host.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }
const SIGNAL = new AbortController().signal

function definition(agentName: string, body: string, modelOrder: string[]) {
  return {
    agentName,
    name: agentName,
    description: 'fixture expert',
    body,
    modelOrder,
    source: 'project-dsh' as const,
    origin: 'user' as const,
    providerId: 'test',
    extra: {},
    path: '/fixtures/' + agentName + '/' + agentName + '.agent.md',
  }
}

function composed(agentName = 'atlas', body = 'You review code.', modelOrder = ['smart']) {
  return {
    ok: true,
    agent: definition(agentName, body, modelOrder),
    parameters: {
      route: ROUTE,
      reasoningEffort: 'high',
      persona: body,
      toolFilter: [],
      flavor: 'spawn',
      effortSource: 'agent',
    },
    report: { selectedBy: 'raw', candidates: [] },
  }
}

interface Observation {
  text: string
  tools: string[]
  route: unknown
}

async function mount(compose: () => unknown, rootOptions: Record<string, unknown>) {
  const ctx = ownContext(new Context())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const sessionRoot = await mkdtemp(join(tmpdir(), 'atelier-host-summon-'))
  onTestFinished(async () => { await rm(sessionRoot, { recursive: true, force: true }) })
  await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot })
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(SubagentRuntime)

  const provider = {
    name: 'spawn',
    inheritsParentContext: false,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true },
    // Method presence selects the local/continuable path, the only path that
    // accepts the reserved child id this row passes.
    prepareContinuable: async () => ({}),
  }
  await ctx.plugin(Object.assign((inner: Context) => { inner.subagents.registerProvider(provider as never) }, { inject: ['subagents'] }))

  ctx.provide('agentControl', { composeSession: async () => compose() })
  ctx.provide('agentAssembly', createAssemblyService())
  const row = ctx.plugin({ apply: (inner: Context) => applySummon(inner, {}) })
  await row.await()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const root = await harness.create(SessionId('root-1'), rootOptions as never)
  const observations: Observation[] = []
  ctx.on('agent/created', async (payload: any) => {
    const child = payload.agent
    if (child.id === root.id) return
    observations.push({
      text: renderPrompt(await ctx.systemPrompt.assemble({ scope: child })),
      tools: ctx.tools.schemas(child).map((schema: any) => schema.name),
      route: child.model.current(),
    })
  })

  const result = await executeModelToolFixture(ctx, {
    callId: ToolCallId('call-1'),
    name: 'summon_agent',
    arguments: { agent: 'atlas', description: 'review', prompt: 'read it' },
    signal: SIGNAL,
    agent: root as never,
  })
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
  return { ctx, root, observations }
}

describe('real AgentLoop + subagent service', () => {
  it('gives the summoned child its persona and hides all delegation entries before its provider starts', async () => {
    const { ctx, root, observations } = await mount(() => composed(), { provider: ROUTE.provider, model: ROUTE.model })
    expect(ctx.tools.schemas(root as never).map((schema: any) => schema.name)).toEqual(['summon_agent'])
    expect(observations).toHaveLength(1)
    const [observation] = observations
    expect(observation?.text).toContain('You review code.')
    expect(observation?.text).not.toContain('You are the deployment persona.')
    expect(observation?.tools).toEqual([])
  })

  it('omits agentOptions for the default bridge, so the child inherits the parent route', async () => {
    const { observations } = await mount(() => composed('default', '', ['dsh-default']), { provider: ROUTE.provider, model: ROUTE.model })
    expect(observations[0]?.route).toMatchObject(ROUTE)
  })
})
