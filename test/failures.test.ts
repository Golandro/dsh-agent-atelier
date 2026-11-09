/**
 * Ticket 07b / #56: the failure recorder's pure fold — classification, request
 * vs attempt accounting, the two rate-limit rules, dedupe and reset.
 *
 * Every case pins one line of the R2 §3.2/§3.3 口径 the ticket calls out:
 * `failures` counts terminal requests only, `rateLimitStreak` is request-level
 * and windowed, `UNKNOWN` is not accounted, and the projection is deterministic.
 */
import { describe, expect, it } from 'vitest'

import { classify, createFailureRecorder, type FailureSignal } from '../src/control/failures.ts'
import { RATE_LIMIT_WINDOW_MS } from '../src/core/resolve/observations.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' } as const
const OTHER = { provider: 'vendor', model: 'other' } as const
const NOW = 1_000_000

/** One signal with the defaults every counter case wants; override what the case is about. */
function signal(overrides: Partial<FailureSignal> = {}): FailureSignal {
  return {
    route: ROUTE,
    code: 'SERVER',
    at: NOW,
    terminal: true,
    source: 'request-error',
    ...overrides,
  }
}

/** One request identity; turn/step default to a fresh request per call site. */
function request(turn: number, step = 1) {
  return { sessionId: 'session-1', turn, step }
}

describe('classify (R2 §2.3)', () => {
  it('maps the named adapter codes to their classes', () => {
    expect(classify({ code: 'SERVER' })).toBe('transient-server')
    expect(classify({ code: 'TIMEOUT' })).toBe('transient-timeout')
    expect(classify({ code: 'TRANSPORT' })).toBe('transient-transport')
    expect(classify({ code: 'EMPTY_RESPONSE' })).toBe('empty-response')
    expect(classify({ code: 'RATE_LIMIT' })).toBe('rate-limit')
    expect(classify({ code: 'AUTH' })).toBe('auth')
    expect(classify({ code: 'ACCOUNT_TOKEN_INVALID' })).toBe('auth')
    expect(classify({ code: 'QUOTA' })).toBe('quota')
    expect(classify({ code: 'ACCOUNT_QUOTA' })).toBe('quota')
    expect(classify({ code: 'INVALID_REQUEST' })).toBe('invalid-request')
    expect(classify({ code: 'CONTEXT_WINDOW_EXCEEDED' })).toBe('context-overflow')
    expect(classify({ code: 'UNKNOWN' })).toBe('transient-unknown')
  })

  it('reads the generic HTTP_<status> fallback, and a bare status when the code names nothing', () => {
    expect(classify({ code: 'HTTP_502' })).toBe('transient-server')
    expect(classify({ code: 'HTTP_429' })).toBe('rate-limit')
    expect(classify({ code: 'HTTP_401' })).toBe('auth')
    expect(classify({ code: 'HTTP_403' })).toBe('auth')
    expect(classify({ code: 'HTTP_402' })).toBe('quota')
    expect(classify({ code: 'HTTP_400' })).toBe('invalid-request')
    expect(classify({ code: 'HTTP_404' })).toBe('transient-unknown')
    expect(classify({ code: 'PI_AI_ERROR' })).toBe('transient-transport')
    // The code wins over a stale `status`; only an unparseable code falls back to it.
    expect(classify({ code: 'HTTP_500', status: 401 })).toBe('transient-server')
    expect(classify({ code: 'SOMETHING_NEW', status: 503 })).toBe('transient-server')
    expect(classify({ code: 'SOMETHING_NEW' })).toBe('transient-unknown')
  })
})

describe('failures: request-terminal only, one class at a time (R2 §3.2)', () => {
  it('counts a terminal request once and exposes it on the route', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ request: request(1) }))
    recorder.record(signal({ request: request(2) }))

    expect(recorder.observations(NOW).routes).toEqual([{
      route: ROUTE,
      failures: 2,
      lastFailureCode: 'SERVER',
      lastFailureAt: NOW,
    }])
  })

  it('moves attempts onto the display fields but never into failures', () => {
    const recorder = createFailureRecorder()
    // A retry led to a successful request: three attempts, no terminal failure.
    recorder.record(signal({ terminal: false, source: 'llm-stream', at: NOW }))
    recorder.record(signal({ terminal: false, source: 'llm-stream', at: NOW + 5 }))
    recorder.record(signal({ terminal: false, source: 'llm-stream', at: NOW + 10 }))

    expect(recorder.observations(NOW).routes).toEqual([{
      route: ROUTE,
      lastFailureCode: 'SERVER',
      lastFailureAt: NOW + 10,
    }])
  })

  it('keeps two classes apart, so "same-class >= 2" cannot be summed across them', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ request: request(1) })) // SERVER
    recorder.record(signal({ code: 'TIMEOUT', request: request(2) }))
    recorder.record(signal({ code: 'TIMEOUT', request: request(3) }))

    // transient-server has one, transient-timeout has two: the max is the threshold reading.
    expect(recorder.observations(NOW).routes[0]).toMatchObject({ failures: 2, lastFailureCode: 'TIMEOUT' })
  })

  it('keeps UNKNOWN and the unjudgeable classes out of the ledger entirely', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'UNKNOWN', request: request(1) }))
    recorder.record(signal({ code: 'INVALID_REQUEST', request: request(2) }))
    recorder.record(signal({ code: 'CONTEXT_WINDOW_EXCEEDED', request: request(3) }))
    recorder.record(signal({ code: 'SOMETHING_NEW', request: request(4) }))

    expect(recorder.observations(NOW).routes).toEqual([])
  })

  it('records AUTH/QUOTA for display only: no failure counter, so no degradation evidence', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'AUTH', request: request(1) }))
    recorder.record(signal({ code: 'QUOTA', request: request(2) }))

    const [record] = recorder.observations(NOW).routes
    expect(record).toEqual({ route: ROUTE, lastFailureCode: 'QUOTA', lastFailureAt: NOW })
    expect(record?.failures).toBeUndefined()
  })

  it('deduplicates one request by (session, turn, step), but not across steps', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ request: request(1) }))
    recorder.record(signal({ request: request(1) })) // same request, second dispatch
    recorder.record(signal({ request: request(2) }))

    expect(recorder.observations(NOW).routes[0]?.failures).toBe(2)
  })

  it('drops an attempt-level signal of an unjudgeable class too', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'UNKNOWN', terminal: false, source: 'llm-stream' }))

    expect(recorder.observations(NOW).routes).toEqual([])
  })
})

describe('rateLimitStreak: request-level and windowed (R2 §2.4, §3.3)', () => {
  it('counts three distinct limited requests as one streak and no failure', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(1), at: NOW }))
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(2), at: NOW + 100 }))
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(3), at: NOW + 200 }))

    expect(recorder.observations(NOW + 300).routes).toEqual([{
      route: ROUTE,
      rateLimitStreak: 3,
      rateLimitSince: NOW,
      lastFailureCode: 'RATE_LIMIT',
      lastFailureAt: NOW + 200,
    }])
  })

  it('counts attempts of one request once, not once per retry', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(1) }))
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(1), at: NOW + 10 }))
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(1), at: NOW + 20 }))

    expect(recorder.observations(NOW).routes[0]?.rateLimitStreak).toBe(1)
  })

  it('restarts the streak once the window passed, both at record and at read', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(1), at: NOW }))
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(2), at: NOW + RATE_LIMIT_WINDOW_MS + 1 }))

    // The second hit is a fresh streak, not a stale 2.
    expect(recorder.observations(NOW + RATE_LIMIT_WINDOW_MS + 2).routes[0]).toMatchObject({
      rateLimitStreak: 1,
      rateLimitSince: NOW + RATE_LIMIT_WINDOW_MS + 1,
    })
    // Read past the window: the streak is no longer "sustained" and is not exposed.
    expect(recorder.observations(NOW + 2 * RATE_LIMIT_WINDOW_MS + 2).routes[0]?.rateLimitStreak).toBeUndefined()
  })

  it('lets any other terminal request interrupt the consecutive streak', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(1), at: NOW }))
    recorder.record(signal({ code: 'SERVER', request: request(2), at: NOW + 10 }))
    recorder.record(signal({ code: 'RATE_LIMIT', request: request(3), at: NOW + 20 }))

    expect(recorder.observations(NOW + 30).routes[0]).toMatchObject({ rateLimitStreak: 1, rateLimitSince: NOW + 20 })
  })
})

describe('reset and projection shape', () => {
  it('resets one route or the whole ledger', () => {
    const recorder = createFailureRecorder()
    recorder.record(signal({ request: request(1) }))
    recorder.record(signal({ route: OTHER, request: request(2) }))
    expect(recorder.observations(NOW).routes).toHaveLength(2)

    recorder.reset(OTHER)
    expect(recorder.observations(NOW).routes.map((record) => record.route)).toEqual([ROUTE])

    recorder.reset()
    expect(recorder.observations(NOW).routes).toEqual([])
  })

  it('orders routes deterministically no matter the recording order', () => {
    const first = createFailureRecorder()
    first.record(signal({ route: ROUTE, request: request(1) }))
    first.record(signal({ route: OTHER, request: request(2) }))

    const second = createFailureRecorder()
    second.record(signal({ route: OTHER, request: request(2) }))
    second.record(signal({ route: ROUTE, request: request(1) }))

    expect(first.observations(NOW)).toEqual(second.observations(NOW))
  })

  it('starts empty, so "no observations" and a fresh recorder agree', () => {
    expect(createFailureRecorder().observations(NOW)).toEqual({ routes: [] })
  })
})
