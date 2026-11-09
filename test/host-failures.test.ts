/**
 * Ticket 07b / #56: both ledger legs reach a row-shaped listener on a **real**
 * host (real LlmRuntime + real AgentLoop + real Session/JSONL), and the final
 * ledger counts one request, not one attempt.
 *
 * The fake adapter only yields a terminal RATE_LIMIT finish, and no llm-retry
 * middleware is mounted, so the request is terminal on its first attempt — the
 * exact situation where leg B (one finish) and leg A (one waterfall dispatch)
 * fire for the same request. The assertion that `failures` is 1 and the
 * streak is 1 pins the "one request, one count" rule.
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

import { createFailureRecorder } from '../src/control/failures.ts'
import { mountFailureLedger } from '../src/dsh/host/failures.ts'
import { ownContext } from './support/host.ts'

const NOW = 1_000_000

/** Adapter whose every call ends in a terminal failure finish with the given code. */
class FailingAdapter extends LlmAdapter {
  readonly #code: string

  constructor(code: string) {
    super()
    this.#code = code
  }

  override async *stream(): AsyncIterable<any> {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'probe: ' + this.#code, code: this.#code, status: 503 } } }
  }
}

async function mount(code = 'RATE_LIMIT') {
  const ctx = ownContext(new Context())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const root = await mkdtemp(join(tmpdir(), 'atelier-ledger-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(JsonlSessionPersistence, { root })
  const harness = await mountAgentLoopTestHarness(ctx)

  const recorder = createFailureRecorder()
  const row = ctx.plugin({
    apply: (inner: Context) => { mountFailureLedger(inner, recorder, { now: () => NOW }) },
  })
  await (row as any).await()

  ctx.llm.registerAdapter(['probe'], new FailingAdapter(code))
  return { harness, recorder }
}

describe('07b wiring on a real host', () => {
  it('records one terminal request with both legs, and the failed route', async () => {
    const { harness, recorder } = await mount()
    const agent = await harness.create(SessionId('ledger-a'), { provider: 'probe', model: 'probe-small' })
    agent.send(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), 'next-turn', true)

    await waitFor(() => recorder.observations(NOW + 1_000).routes.length > 0, 'first ledger record')

    expect(recorder.observations(NOW + 1_000).routes).toEqual([{
      route: { provider: 'probe', model: 'probe-small' },
      // One request: leg B's attempt signal and leg A's terminal signal collapse
      // into one streak entry, not two. RATE_LIMIT never feeds `failures`.
      rateLimitStreak: 1,
      rateLimitSince: NOW,
      lastFailureCode: 'RATE_LIMIT',
      lastFailureAt: NOW,
    }])
  })

  it('counts a terminal transient failure once, not once per attempt/leg', async () => {
    const { harness, recorder } = await mount('SERVER')
    const agent = await harness.create(SessionId('ledger-b'), { provider: 'probe', model: 'probe-small' })
    agent.send(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), 'next-turn', true)

    await waitFor(() => recorder.observations(NOW + 1_000).routes.length > 0, 'first ledger record')
    expect(recorder.observations(NOW + 1_000).routes).toEqual([{
      route: { provider: 'probe', model: 'probe-small' },
      failures: 1,
      lastFailureCode: 'SERVER',
      lastFailureAt: NOW,
    }])
  })
})

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('ledger probe timed out waiting for ' + label)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
