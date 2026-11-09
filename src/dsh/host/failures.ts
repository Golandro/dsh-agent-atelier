/**
 * The failure-ledger wiring (ticket 07b / #56): the two runtime legs that feed
 * the in-memory {@link FailureRecorder} the summon executor hands to chain
 * resolution.
 *
 * Leg A (`agent/request-error`) is the only source of the terminal judgement.
 * A waterfall listener must **delegate first and record after**: `await next()`
 * and return its action untouched (never consume `{kind:'retry'}`); then
 * `action === undefined` means llm-retry gave up, so this request is terminal
 * (07a §4.1). The failed route is read from `session.requestContext()` — the
 * `request/context` entry appended right before the stream starts — never
 * from `agent.model.current()`, which is the *next step's* selection (07a
 * §1.4). When no route can be read, the signal is not recorded: an
 * unidentifiable failure must not demote a route (R2 §3.4).
 *
 * Leg B (`llm/stream`) wraps the chunk stream and records the terminal
 * `finish{reason:{kind:'error',failure}}` with the per-attempt route from
 * `options`. It cannot know whether llm-retry will retry, so every signal it
 * emits is an attempt (`terminal: false`): it moves the display fields and the
 * counters only, never `failures`. This also covers calls with no Agent
 * request behind them (compaction, titles): they are recorded with no request
 * identity rather than a faked one (07a §4.6). Recording is wrapped so a
 * ledger defect can never break the stream it observes.
 *
 * The listener is mounted on the row's own context (no scope tag), so it sees
 * every Agent's failures; a future per-Agent mount would narrow it by scoping
 * the listener instead (07a §4.5).
 */
import type { Context } from '@deepseek-ai/cordis'

import type { FailureRecorder, FailureRequest, FailureSignal } from '../../control/index.ts'

/** The `LlmFailure` members this row reads (DSH's serializable failure facts). */
interface HostFailure {
  readonly message: string
  readonly code: string
  readonly status?: number | undefined
  readonly providerRetryAfterMs?: number | undefined
}

/** The collapsed `request/context` read: the route of the request in flight. */
interface HostRequestContext {
  readonly provider: string
  readonly model: string
}

/** The session slice the two legs read; never imported from the host package. */
interface HostSession {
  readonly header?: { readonly id?: unknown } | undefined
  requestContext?(): HostRequestContext | undefined
}

/** The live Agent slice a failure payload carries. */
interface HostAgent {
  readonly id: string
  readonly session: HostSession
}

/** `agent/request-error` payload, as installed DSH 0.2.2-rc.1 dispatches it. */
interface RequestErrorPayload {
  readonly agent: HostAgent
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly failure: HostFailure
}

/** The only action llm-retry returns when it owns recovery; `undefined` is terminal. */
type RequestErrorAction = { readonly kind: 'retry' } | undefined

/** `llm/stream` generate options slice: the exact per-attempt route. */
interface StreamOptions {
  readonly provider: string
  readonly model: string
}

/** One terminal finish reason of a chunk stream (only the error branch is read). */
interface ChunkFinishReason {
  readonly kind: string
  readonly failure?: HostFailure | undefined
}

/** `StreamChunk` slice: every chunk carries a type; finish is the one that matters. */
type StreamChunk = { readonly type: string } | { readonly type: 'finish'; readonly reason: ChunkFinishReason }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The waterfall that decides whether a failed request attempt is retried.
     * Declared locally because the host package is type-only external and never
     * imported at runtime (ADR-0001).
     */
    'agent/request-error'(this: unknown, payload: RequestErrorPayload, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
    /** The per-model-call waterfall that wraps the adapter chunk stream. */
    'llm/stream'(this: unknown, options: StreamOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  }
}

/** Test/clock seams of the wiring; production passes neither. */
export interface FailureLedgerOptions {
  /** Clock for signal timestamps and windows; defaults to `Date.now`. */
  readonly now?: (() => number) | undefined
  /** Receives ledger defects instead of throwing into the observed event. */
  readonly warn?: ((message: string, error: unknown) => void) | undefined
}

/**
 * Mount both legs on `ctx` and return their combined disposer.
 *
 * The caller owns the recorder (one per row lifetime) and wraps the disposer
 * in `ctx.effect`, so an unload lifts the listeners instead of leaving a
 * stale observer writing into a freed ledger.
 */
export function mountFailureLedger(ctx: Context, recorder: FailureRecorder, options: FailureLedgerOptions = {}): () => void {
  const clock = options.now ?? (() => Date.now())
  const warn = options.warn ?? ((message: string, error: unknown) => {
    ctx.logger.warn(message + ': ' + messageOf(error))
  })

  // Leg A: delegate first, record after, return the action untouched.
  const stopErrors = ctx.on('agent/request-error', async (payload, next) => {
    const action = await next()
    try {
      recordRequestError(recorder, payload, action, clock())
    } catch (error) {
      warn('atelier failure ledger: request-error recording failed', error)
    }
    return action
  })

  // Leg B: wrap the stream; never alter the chunks, never break on a record failure.
  const stopStreams = ctx.on('llm/stream', (streamOptions, next) =>
    wrapStream(next(), streamOptions, recorder, clock, warn))

  return () => {
    stopErrors()
    stopStreams()
  }
}

/** Fold one `agent/request-error` dispatch into the recorder (or drop it when unnamed). */
function recordRequestError(recorder: FailureRecorder, payload: RequestErrorPayload, action: RequestErrorAction, at: number): void {
  const route = payload.agent.session.requestContext?.()
  // No route ⇒ not attributable ⇒ not accounted (R2 §3.4); never fall back to
  // `agent.model.current()`, which names the next step's choice (07a §1.4).
  if (route === undefined) return
  const failure = payload.failure
  const request = requestOf(payload)
  const signal: FailureSignal = {
    route: { provider: route.provider, model: route.model },
    code: failure.code,
    ...failure.status === undefined ? {} : { status: failure.status },
    ...failure.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: failure.providerRetryAfterMs },
    at,
    terminal: action === undefined,
    source: 'request-error',
    ...request === undefined ? {} : { request },
  }
  recorder.record(signal)
}

/** The request key of one dispatch; absent when the Agent exposes no identity. */
function requestOf(payload: RequestErrorPayload): FailureRequest | undefined {
  const sessionId = sessionIdOf(payload.agent)
  if (sessionId === undefined) return undefined
  return { sessionId, turn: payload.turn, step: payload.step }
}

/** The session id from the header, falling back to the Agent id (both are stable strings). */
function sessionIdOf(agent: HostAgent): string | undefined {
  const headerId = agent.session.header?.id
  if (typeof headerId === 'string' && headerId !== '') return headerId
  return agent.id !== '' ? agent.id : undefined
}

/** Wrap one model-call stream: pass every chunk through, record a terminal error finish. */
async function* wrapStream(
  stream: AsyncIterable<StreamChunk>,
  streamOptions: StreamOptions,
  recorder: FailureRecorder,
  clock: () => number,
  warn: (message: string, error: unknown) => void,
): AsyncIterable<StreamChunk> {
  for await (const chunk of stream) {
    const failure = errorFailureOf(chunk)
    if (failure !== undefined) {
      try {
        recorder.record({
          route: { provider: streamOptions.provider, model: streamOptions.model },
          code: failure.code,
          ...failure.status === undefined ? {} : { status: failure.status },
          ...failure.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: failure.providerRetryAfterMs },
          at: clock(),
          // Leg B cannot see llm-retry's decision: this stays an attempt.
          terminal: false,
          source: 'llm-stream',
        })
      } catch (error) {
        warn('atelier failure ledger: llm/stream recording failed', error)
      }
    }
    yield chunk
  }
}

/** The failure of a `finish` chunk, or `undefined` for every other chunk (aborted included). */
function errorFailureOf(chunk: unknown): HostFailure | undefined {
  if (typeof chunk !== 'object' || chunk === null) return undefined
  const candidate = chunk as { readonly type?: unknown; readonly reason?: unknown }
  if (candidate.type !== 'finish') return undefined
  const reason = candidate.reason as { readonly kind?: unknown; readonly failure?: unknown } | undefined
  if (reason?.kind !== 'error') return undefined
  const failure = reason.failure as Partial<HostFailure> | undefined
  if (failure === undefined || typeof failure.code !== 'string') return undefined
  return failure as HostFailure
}

/** One line for a warning even when the thrown value is not an Error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
