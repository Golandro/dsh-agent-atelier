/**
 * Research probe for ticket 07a (#55): do the two failure-ledger legs reach a
 * bundle-row listener, and which supported read carries the failed route?
 *
 * Real LlmRuntime + real AgentLoop + real Session in one process, with a fake
 * adapter that only yields a terminal error finish. Nothing here is a
 * production recorder: `llm/stream` and `agent/request-error` are read from a
 * plugin-row context, exactly where the FailureRecorder would live.
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

import { ownContext } from './support/host.ts'

/** Adapter whose every call ends in a terminal RATE_LIMIT failure finish. */
class FailingAdapter extends LlmAdapter {
  override async *stream(): AsyncIterable<any> {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'probe: rate limit', code: 'RATE_LIMIT' } } }
  }
}

interface LlmCall {
  provider: string
  model: string
}

interface FailureObservation {
  payloadProvider: string
  requestContext: { provider: string; model: string } | undefined
  modelCurrent: { provider: string; model: string } | undefined
}

async function mount() {
  const ctx = ownContext(new Context())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const root = await mkdtemp(join(tmpdir(), 'atelier-probe-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(JsonlSessionPersistence, { root })
  const harness = await mountAgentLoopTestHarness(ctx)

  const llmCalls: LlmCall[] = []
  const failureFinishes: string[] = []
  const failures: FailureObservation[] = []
  let streamWrapped = 0

  const row = ctx.plugin({ apply: (inner: Context) => {
    inner.on('llm/stream', (options: any, next: () => AsyncIterable<any>) => {
      log('llm/stream listener entered')
      llmCalls.push({ provider: options.provider, model: options.model })
      return (async function* () {
        streamWrapped += 1
        for await (const chunk of next()) {
          if (chunk.type === 'finish' && chunk.reason.kind === 'error') failureFinishes.push(chunk.reason.failure.code)
          yield chunk
        }
      })()
    })
    inner.on('agent/request-error', (payload: any, next: () => Promise<unknown>) => {
      log('agent/request-error listener entered')
      failures.push({
        payloadProvider: payload.provider,
        requestContext: payload.agent.session.requestContext(),
        modelCurrent: payload.agent.model.current(),
      })
      return next()
    })
  } })
  await (row as any).await()

  ctx.llm.registerAdapter(['probe'], new FailingAdapter())
  return { ctx, harness, llmCalls, failureFinishes, failures, streamWrapped: () => streamWrapped }
}

function log(message: string) {
  process.stdout.write('PROBE ' + message + '\n')
}

describe('07a probe: failure ledger legs from a bundle row', () => {
  it('delivers llm/stream to a row listener with the exact per-attempt route', async () => {
    const { ctx, harness, llmCalls, failureFinishes, streamWrapped } = await mount()
    const agent = await harness.create(SessionId('probe-b'), { provider: 'probe', model: 'probe-small' })
    agent.send(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), 'next-turn', true)
    await waitFor(() => failureFinishes.length > 0, 'llm/stream failure finish')
    expect(llmCalls).toEqual([{ provider: 'probe', model: 'probe-small' }])
    expect(streamWrapped()).toBe(1)
    expect(failureFinishes).toEqual(['RATE_LIMIT'])
    expect(agent.session.requestContext()).toMatchObject({ provider: 'probe', model: 'probe-small' })
  })

  it('delivers agent/request-error to a row listener and names the failed route', async () => {
    const { ctx, harness, failures } = await mount()
    const agent = await harness.create(SessionId('probe-a'), { provider: 'probe', model: 'probe-small' })
    agent.send(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), 'next-turn', true)
    await waitFor(() => failures.length > 0, 'agent/request-error')
    expect(failures).toHaveLength(1)
    const failure = failures[0]!
    expect(failure.payloadProvider).toBe('probe')
    expect(failure.requestContext).toEqual({ provider: 'probe', model: 'probe-small' })
    expect(failure.modelCurrent).toMatchObject({ provider: 'probe', model: 'probe-small' })
  })
})

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('probe timed out waiting for ' + label)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
