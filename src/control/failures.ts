/**
 * Runtime failure ledger recorder (ticket 07b / #56): the in-memory fold from
 * DSH failure signals to the pure `ChainObservations` the chain engine reads
 * (R2 §3.1-§3.3).
 *
 * One rule per counter, because the two axes answer different questions:
 *
 * - `failures` counts **request-terminal** failures of the transient classes.
 *   One request counts once no matter how many attempts llm-retry burned
 *   (§3.2), which is what keeps `DEGRADED_FAILURES = 2` meaning "two requests
 *   failed", not "two attempts". An attempt-level signal is display-only:
 *   it updates `lastFailureCode`/`lastFailureAt` and touches no counter.
 * - `rateLimitStreak` counts **requests** too, deduplicated by
 *   `(session, turn, step)`, and restarts once the ledger window has passed
 *   since its first hit (§2.4, §3.3). `RATE_LIMIT` never feeds `failures`:
 *   two limited requests must not read as "degraded" while the streak rule
 *   still calls the same situation a single spike.
 *
 * Classes that cannot judge the route are not accounted: `invalid-request` and
 * `context-overflow` are the request's fault, never the route's, and
 * `transient-unknown` (unknown codes, `UNKNOWN`, provider fallbacks such as
 * `PI_AI_ERROR` that cannot be falsified) must not demote a route (§3.4).
 * `auth` and `quota` are display-only: they are configuration/provider facts,
 * and v1's projection has no provider-level counter for them.
 *
 * The recorder never reads the clock. Every signal carries `at` (the wiring
 * injects it), and `observations(now)` judges the rate-limit window against
 * the injected `now`, so the whole fold stays deterministic and testable.
 */
import { RATE_LIMIT_WINDOW_MS, routeKey } from '../resolve/index.ts'

import type { ChainObservations, ModelRoute, RouteObservation } from '../contract/index.ts'

/**
 * R2 §2.3's class for one failure. `transient-unknown` is the default for any
 * code or status the taxonomy does not name: an unclassifiable failure is not
 * evidence about the route.
 */
export type FailureClass =
  | 'transient-server'
  | 'transient-timeout'
  | 'transient-transport'
  | 'empty-response'
  | 'rate-limit'
  | 'auth'
  | 'quota'
  | 'invalid-request'
  | 'context-overflow'
  | 'transient-unknown'

/** Where a signal came from; only `request-error` can know the request ended. */
export type FailureSource = 'request-error' | 'llm-stream' | 'turn-end'

/** The `(session, turn, step)` identity a request-level counter deduplicates by. */
export interface FailureRequest {
  readonly sessionId: string
  readonly turn: number
  readonly step: number
}

/**
 * One failure as the runtime saw it: the route and the serializable `LlmFailure`
 * facts, plus the two facts only the wrapper can add (terminality, source).
 * Shape-compatible with DSH's `LlmFailure`; never imports it (ADR-0001).
 */
export interface FailureSignal {
  /** The exact `provider/model` pair this attempt ran on. */
  readonly route: ModelRoute
  /** DSH's stable failure code (`SERVER`, `RATE_LIMIT`, `UNKNOWN`, `HTTP_<status>`…). */
  readonly code: string
  /** HTTP status, when the adapter had one. */
  readonly status?: number | undefined
  /** Provider-requested delay, when it had one. */
  readonly providerRetryAfterMs?: number | undefined
  /** Epoch milliseconds of the signal (injected by the wiring, never read here). */
  readonly at: number
  /**
   * Whether llm-retry gave up on this request. Only the `agent/request-error`
   * observer can answer it (the waterfall's `next()` returned `undefined`);
   * `llm/stream` failures are attempts and stay `false`.
   */
  readonly terminal: boolean
  readonly source: FailureSource
  /** The request-level dedupe key; absent for calls that have no Agent request. */
  readonly request?: FailureRequest | undefined
}

/** One route's mutable fold; `observations()` projects it, `reset()` drops it. */
interface RouteRecord {
  readonly route: ModelRoute
  /** Accounted request-terminal failures, keyed by class so two classes never merge. */
  readonly failuresByClass: Map<FailureClass, number>
  rateLimitStreak: number
  rateLimitSince: number | undefined
  lastFailureCode: string | undefined
  lastFailureAt: number | undefined
}

/** How many terminal request keys the dedupe memory keeps (FIFO, bounded). */
const MAX_TERMINAL_KEYS = 1024

/** Classes that count toward `failures` (R2 §2.2: same class reaches `degraded` at two). */
const ACCOUNTED_CLASSES: ReadonlySet<FailureClass> = new Set<FailureClass>([
  'transient-server',
  'transient-timeout',
  'transient-transport',
  'empty-response',
])

/** Codes whose class is decided by the code string alone (R2 §2.3, adapter tables). */
const CODE_CLASSES: Readonly<Record<string, FailureClass>> = {
  ACCOUNT_QUOTA: 'quota',
  ACCOUNT_TOKEN_INVALID: 'auth',
  AUTH: 'auth',
  CONTEXT_WINDOW_EXCEEDED: 'context-overflow',
  EMPTY_RESPONSE: 'empty-response',
  INVALID_REQUEST: 'invalid-request',
  PI_AI_ERROR: 'transient-transport',
  QUOTA: 'quota',
  RATE_LIMIT: 'rate-limit',
  SERVER: 'transient-server',
  TIMEOUT: 'transient-timeout',
  TRANSPORT: 'transient-transport',
  UNKNOWN: 'transient-unknown',
}

/** The class one failure belongs to (R2 §2.3); never throws, never guesses a downgrade. */
export function classify(signal: Pick<FailureSignal, 'code' | 'status'>): FailureClass {
  const named = CODE_CLASSES[signal.code]
  if (named !== undefined) return named

  // The generic adapter fallback names the HTTP status in the code itself
  // (`HTTP_<status>`); read it when the adapter did not also pass `status`.
  const http = signal.code.startsWith('HTTP_') ? Number(signal.code.slice('HTTP_'.length)) : undefined
  const status = Number.isInteger(http) ? http : signal.status
  if (status === undefined) return 'transient-unknown'

  if (status >= 500) return 'transient-server'
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 400 || status === 413) return 'invalid-request'
  return 'transient-unknown'
}

/**
 * The ledger's writer (ticket 07b): in-memory, session-lived, no persistence.
 *
 * `record` is total and never throws — the wiring still guards it so a defect
 * cannot break the event it observes. `observations(now)` is a pure read of
 * the fold; `reset` drops one route (or the whole ledger) for the UI's reset
 * action (R2 §2.5 v1).
 */
export interface FailureRecorder {
  /** Fold one signal; attempt-level signals only move the display fields. */
  record(signal: FailureSignal): void
  /** The ledger as chain resolution reads it, judged against `now` (epoch ms). */
  observations(now: number): ChainObservations
  /** Drop one route's record, or every route when `route` is absent. */
  reset(route?: ModelRoute): void
}

/** Create an empty recorder; every recorder is its own ledger, never shared. */
export function createFailureRecorder(): FailureRecorder {
  const records = new Map<string, RouteRecord>()
  const terminalKeys = new Map<string, true>()

  /** Remember one terminal request key; false means this request was already counted. */
  function claimTerminal(key: string): boolean {
    if (terminalKeys.has(key)) return false
    terminalKeys.set(key, true)
    if (terminalKeys.size > MAX_TERMINAL_KEYS) {
      const oldest = terminalKeys.keys().next().value
      if (oldest !== undefined) terminalKeys.delete(oldest)
    }
    return true
  }

  function recordOf(route: ModelRoute): RouteRecord {
    const key = routeKey(route)
    const existing = records.get(key)
    if (existing !== undefined) return existing
    const created: RouteRecord = {
      route: { provider: route.provider, model: route.model },
      failuresByClass: new Map(),
      rateLimitStreak: 0,
      rateLimitSince: undefined,
      lastFailureCode: undefined,
      lastFailureAt: undefined,
    }
    records.set(key, created)
    return created
  }

  function record(signal: FailureSignal): void {
    const failureClass = classify(signal)
    // Not evidence about the route (see the module doc); drop before any fold.
    if (failureClass === 'invalid-request' || failureClass === 'context-overflow' || failureClass === 'transient-unknown') return

    const record = recordOf(signal.route)
    // Display facts move for attempts too; counters do not.
    record.lastFailureCode = signal.code
    record.lastFailureAt = signal.at

    if (!signal.terminal) return

    if (signal.request !== undefined) {
      const key = signal.request.sessionId + '\u0000' + signal.request.turn + '\u0000' + signal.request.step
      if (!claimTerminal(key)) return
    }

    if (failureClass === 'rate-limit') {
      // A window that already passed starts a new streak; the old count is
      // stale and must not accumulate into the next "sustained" judgement.
      const since = record.rateLimitSince
      if (since === undefined || signal.at - since > RATE_LIMIT_WINDOW_MS) {
        record.rateLimitStreak = 1
        record.rateLimitSince = signal.at
      } else {
        record.rateLimitStreak += 1
      }
      return
    }

    // Any other terminal request on the route interrupts the limit streak:
    // the next `RATE_LIMIT` is not consecutive with the previous ones.
    record.rateLimitStreak = 0
    record.rateLimitSince = undefined

    // Whatever is left is a display-only class; it has no health counter.
    if (!ACCOUNTED_CLASSES.has(failureClass)) return
    record.failuresByClass.set(failureClass, (record.failuresByClass.get(failureClass) ?? 0) + 1)
  }

  return {
    record,

    observations(now) {
      const routes: RouteObservation[] = []
      for (const [, record] of [...records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        let failures = 0
        for (const count of record.failuresByClass.values()) failures = Math.max(failures, count)
        const since = record.rateLimitSince
        const streak = record.rateLimitStreak > 0
          && since !== undefined
          && now - since <= RATE_LIMIT_WINDOW_MS
          ? record.rateLimitStreak
          : 0
        const observation: RouteObservation = {
          route: record.route,
          ...failures === 0 ? {} : { failures },
          ...streak === 0 || since === undefined ? {} : { rateLimitStreak: streak, rateLimitSince: since },
          ...record.lastFailureCode === undefined ? {} : { lastFailureCode: record.lastFailureCode },
          ...record.lastFailureAt === undefined ? {} : { lastFailureAt: record.lastFailureAt },
        }
        if (observation.failures !== undefined || observation.rateLimitStreak !== undefined || observation.lastFailureCode !== undefined) {
          routes.push(observation)
        }
      }
      return { routes }
    },

    reset(route) {
      if (route === undefined) {
        records.clear()
        terminalKeys.clear()
        return
      }
      records.delete(routeKey(route))
    },
  }
}
