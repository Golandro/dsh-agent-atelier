/**
 * Ticket 07b / #56: the ledger wiring's two legs, driven through the
 * callbacks it registers — the delegation order leg A must keep, the
 * attempt-only reading leg B must produce, and the guards that keep a
 * recording defect out of the observed event.
 *
 * The real host dispatch is covered separately by `test/host-failures.test.ts`;
 * this file pins the wiring's own contract without paying for a host mount.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { createFailureRecorder, type FailureRecorder, type FailureSignal } from '../src/control/failures.ts'
import { mountFailureLedger, type FailureLedgerOptions } from '../src/dsh/host/failures.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' } as const

interface Registered {
  readonly handlers: Map<string, (...args: any[]) => any>
  readonly warns: string[]
  /** Mount the wiring on this fake row and return its combined disposer. */
  mount(recorder: FailureRecorder, options?: FailureLedgerOptions): () => void
  ctx: Context
}

/** A row-shaped context: only `on` and `logger.warn` are read by the wiring. */
function row(): Registered {
  const handlers = new Map<string, (...args: any[]) => any>()
  const warns: string[] = []
  const ctx = {
    on(name: string, callback: (...args: any[]) => any) {
      handlers.set(name, callback)
      return () => { handlers.delete(name) }
    },
    logger: { warn: (message: string) => { warns.push(message) } },
  } as unknown as Context
  return {
    handlers,
    warns,
    ctx,
    mount(recorder, options = {}) {
      return mountFailureLedger(ctx, recorder, options)
    },
  }
}

/** A payload with an identifiable route and request identity. */
function requestError(overrides: Record<string, unknown> = {}) {
  return {
    agent: {
      id: 'agent-1',
      session: {
        header: { id: 'session-1' },
        requestContext: () => ({ provider: ROUTE.provider, model: ROUTE.model }),
      },
    },
    turn: 1,
    step: 1,
    provider: ROUTE.provider,
    failure: { message: 'boom', code: 'SERVER', status: 503 },
    retryPolicy: undefined,
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** An async iterable of the chunks the case names (one entry per yield). */
async function* chunks(...values: unknown[]): AsyncIterable<any> {
  for (const value of values) yield value
}

/** A recorder that reroutes into a real one while also exposing call order/throws. */
function spyRecorder(options: { readonly throwOnRecord?: boolean } = {}): {
  readonly order: string[]
  readonly recorder: FailureRecorder
  readonly real: FailureRecorder
} {
  const real = createFailureRecorder()
  const order: string[] = []
  const recorder: FailureRecorder = {
    record(signal: FailureSignal) {
      order.push('record')
      if (options.throwOnRecord === true) throw new Error('recorder defect')
      real.record(signal)
    },
    observations: real.observations,
    reset: real.reset,
  }
  return { order, recorder, real }
}

describe('leg A: delegate first, record after, return the action untouched (07a §4.1)', () => {
  it('awaits next() before recording and returns {kind:"retry"} as-is', async () => {
    const rowUnderTest = row()
    const spy = spyRecorder()
    rowUnderTest.mount(spy.recorder)
    const handler = rowUnderTest.handlers.get('agent/request-error')!

    const action = { kind: 'retry' as const }
    const result = await handler(requestError(), async () => {
      spy.order.push('next')
      return action
    })

    expect(result).toBe(action)
    expect(spy.order).toEqual(['next', 'record'])
    // A retried attempt is not a terminal request: display only.
    expect(spy.real.observations(1_000).routes[0]?.failures).toBeUndefined()
  })

  it('records one terminal failure when next() answers undefined', async () => {
    const rowUnderTest = row()
    const spy = spyRecorder()
    rowUnderTest.mount(spy.recorder, { now: () => 1_000 })
    const handler = rowUnderTest.handlers.get('agent/request-error')!

    await handler(requestError(), async () => undefined)

    expect(spy.real.observations(2_000).routes).toEqual([{
      route: ROUTE,
      failures: 1,
      lastFailureCode: 'SERVER',
      lastFailureAt: 1_000,
    }])
  })

  it('does not record when the failed route cannot be read (R2 §3.4)', async () => {
    const rowUnderTest = row()
    const spy = spyRecorder()
    rowUnderTest.mount(spy.recorder, { now: () => 1_000 })
    const handler = rowUnderTest.handlers.get('agent/request-error')!

    await handler(requestError({ agent: { id: 'agent-1', session: { header: { id: 'session-1' } } } }), async () => undefined)

    expect(spy.real.observations(2_000).routes).toEqual([])
  })
})

describe('leg B: attempt-level only, chunks pass through unchanged (07a §4.6)', () => {
  it('records the error finish and yields every chunk in order', async () => {
    const rowUnderTest = row()
    const spy = spyRecorder()
    rowUnderTest.mount(spy.recorder, { now: () => 1_000 })
    const handler = rowUnderTest.handlers.get('llm/stream')!
    const input = [
      { type: 'text', text: 'he' },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'rate', code: 'RATE_LIMIT', status: 429 } } },
    ]

    const seen: unknown[] = []
    for await (const chunk of handler({ provider: ROUTE.provider, model: ROUTE.model }, () => chunks(...input))) seen.push(chunk)

    expect(seen).toEqual(input)
    // Attempt-level: the display fields move, the counters do not.
    expect(spy.real.observations(2_000).routes).toEqual([{
      route: ROUTE,
      lastFailureCode: 'RATE_LIMIT',
      lastFailureAt: 1_000,
    }])
  })

  it('ignores a non-error finish and passes it through', async () => {
    const rowUnderTest = row()
    const spy = spyRecorder()
    rowUnderTest.mount(spy.recorder)
    const handler = rowUnderTest.handlers.get('llm/stream')!

    const seen: unknown[] = []
    for await (const chunk of handler({ provider: ROUTE.provider, model: ROUTE.model }, () => chunks({ type: 'finish', reason: { kind: 'stop' } }))) seen.push(chunk)

    expect(seen).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(spy.real.observations(1_000).routes).toEqual([])
  })

  it('keeps the stream intact when the recorder throws, and warns instead', async () => {
    const rowUnderTest = row()
    const broke = spyRecorder({ throwOnRecord: true })
    const warnings: string[] = []
    rowUnderTest.mount(broke.recorder, {
      warn: (message, error) => { warnings.push(message + ': ' + (error as Error).message) },
    })
    const handler = rowUnderTest.handlers.get('llm/stream')!

    const errorFinish = { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'SERVER' } } }
    const seen: unknown[] = []
    for await (const chunk of handler({ provider: ROUTE.provider, model: ROUTE.model }, () => chunks({ type: 'text', text: 'hi' }, errorFinish))) seen.push(chunk)

    expect(seen).toEqual([{ type: 'text', text: 'hi' }, errorFinish])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('recorder defect')
  })

  it('propagates an throwing next() rather than hiding the stream failure', async () => {
    const rowUnderTest = row()
    rowUnderTest.mount(spyRecorder().recorder)
    const handler = rowUnderTest.handlers.get('llm/stream')!

    await expect((async () => {
      for await (const chunk of handler({ provider: ROUTE.provider, model: ROUTE.model }, () => { throw new Error('no stream') })) {
        void chunk
      }
    })()).rejects.toThrow('no stream')
  })
})

describe('lifetime', () => {
  it('lifts both listeners on dispose', () => {
    const rowUnderTest = row()
    const dispose = rowUnderTest.mount(spyRecorder().recorder)
    expect(rowUnderTest.handlers.has('agent/request-error')).toBe(true)
    expect(rowUnderTest.handlers.has('llm/stream')).toBe(true)

    dispose()
    expect(rowUnderTest.handlers.size).toBe(0)
  })
})
