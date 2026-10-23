/**
 * Failure-ledger projection (R2 §3.2, ticket 03 enhancement): the pure function
 * that folds what the runtime learned about each route into the registry
 * snapshot the resolution engine reads.
 *
 * Two axes, never merged (R2 §3.2, "本题最重要的一条接入点语义"):
 * - `available` is the *configuration* switch — durable, the user's will (D6);
 * - `health` is the *runtime* view — ephemeral, the ledger's reading.
 *
 * So this module never writes `available`: it reads it to answer `disabled`,
 * and leaves every other field of the entry exactly as the registry handed it
 * over. The result is a projection, not a new snapshot; feeding it to
 * `resolveModelChain` must give the same report as feeding the ledger itself.
 *
 * v1 has no writer: the ledger is injected plain data (07 records into it in
 * v2), and with no observations every entry projects to `active` — which the
 * engine must treat exactly like "no observations at all".
 */
import type { ChainObservations, ModelDefinition, ModelRoute, RouteHealth } from '../../contract/index.ts'

/** A model entry plus its runtime health; every other field stays the snapshot's. */
export interface ProjectedModel extends ModelDefinition {
  readonly health: RouteHealth
}

/** R2 §2.2: same-class failures reach `degraded` at two — llm-retry already carries one. */
export const DEGRADED_FAILURES = 2

/** R2 §2.4 `RL_STREAK`: this many rate-limit hits inside the window is "sustained", not a spike. */
export const RATE_LIMIT_STREAK = 3

/** R2 §2.4 `RL_WINDOW`: how long a rate-limit streak stays relevant, in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * The ledger's key for a route: the exact `provider/model` pair.
 *
 * Built from the two fields rather than a joined string, so a provider or model
 * id containing `/` can never collide with another pair.
 */
export function routeKey(route: ModelRoute): string {
  return JSON.stringify([route.provider, route.model])
}

/** What the ledger says about one route, already folded to one row per route. */
interface RouteRecord {
  readonly failures: number
  readonly rateLimitStreak: number
  readonly rateLimitSince: number | undefined
}

/**
 * Index the ledger by route. Entries for routes the snapshot does not have are
 * harmless: nothing reads them.
 *
 * A route can appear more than once if the recorder appended instead of
 * updating; the row keeps the highest count per counter (and the first
 * `rateLimitSince` seen), so a duplicated or stale row can never *hide* a
 * failure the recorder knows about.
 */
function indexObservations(observations: ChainObservations | undefined): ReadonlyMap<string, RouteRecord> {
  const byRoute = new Map<string, RouteRecord>()
  for (const observation of observations?.routes ?? []) {
    const key = routeKey(observation.route)
    const previous = byRoute.get(key)
    byRoute.set(key, {
      failures: Math.max(previous?.failures ?? 0, observation.failures ?? 0),
      rateLimitStreak: Math.max(previous?.rateLimitStreak ?? 0, observation.rateLimitStreak ?? 0),
      rateLimitSince: previous?.rateLimitSince ?? observation.rateLimitSince,
    })
  }
  return byRoute
}

/**
 * Project one entry's health (R2 §3.2), in this order:
 *
 * 1. `available: false` ⇒ `disabled` — the configuration axis decides first,
 *    and the ledger is not even consulted (a disabled route is never probed);
 * 2. same-class failures `>= 2` ⇒ `degraded`;
 * 3. `rateLimitStreak >= 3` **and** `now - rateLimitSince <= 60s` ⇒
 *    `degraded` — the streak only matters while it is current;
 * 4. otherwise `active`.
 *
 * `now` is injected (the engine never reads the clock). Without it a rate
 * limit is not judged at all: an unknown "how long ago" cannot be compared
 * against the window, and guessing would either invent or hide a degradation.
 */
export function healthOf(entry: ModelDefinition, ledger: ReadonlyMap<string, RouteRecord>, now: number | undefined): RouteHealth {
  if (!entry.available) return 'disabled'
  const record = ledger.get(routeKey(entry))
  if (record === undefined) return 'active'
  if (record.failures >= DEGRADED_FAILURES) return 'degraded'
  if (record.rateLimitStreak >= RATE_LIMIT_STREAK
    && now !== undefined
    && record.rateLimitSince !== undefined
    && now - record.rateLimitSince <= RATE_LIMIT_WINDOW_MS) return 'degraded'
  return 'active'
}

/**
 * THE projection entry: the snapshot's model list with `health` on each entry.
 *
 * Pure and total (same input, same output, never throws). Never mutates the
 * snapshot, never changes `available`, never drops or reorders an entry — the
 * ordering is the engine's job, on whatever list it is given. `observations`
 * and `now` both default to absent, so `withAvailability(snapshot, undefined,
 * undefined)` is the "no ledger" projection.
 */
export function withAvailability(
  snapshot: { readonly models: readonly ModelDefinition[] },
  observations?: ChainObservations | undefined,
  now?: number | undefined,
): readonly ProjectedModel[] {
  const ledger = indexObservations(observations)
  return snapshot.models.map((entry) => ({ ...entry, health: healthOf(entry, ledger, now) }))
}
