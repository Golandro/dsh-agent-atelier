/**
 * The lazy per-project-root read model both registries serve (D24).
 *
 * Ticket 01's agent scan and ticket 02's layer load want the same thing: the
 * first query for a project root does the work and memoises the result, there is
 * no watcher, concurrent queries share the in-flight work, and a *failed* load is
 * not cached so the next query retries instead of replaying one rejection.
 * Keeping that here means the two services cannot drift apart on the details
 * (signal bookends, memo key, failure caching).
 *
 * The load itself runs without the caller's signal on purpose: the cached
 * result must not depend on which caller happened to arrive first, and a
 * caller-owned abort must not poison the shared work. Each caller still
 * observes its own abort before and after awaiting.
 */

/** Cache key for loads that have no project root (only user-level roots). */
const NO_PROJECT_ROOT_KEY = ''

/** How one registry's reads are keyed and produced. */
export interface LazyLoadOptions<T> {
  /** Resolves the project root for a query; only called when the query has a `cwd`. */
  readonly resolveProjectRoot: (cwd: string) => Promise<string | undefined>
  /** The work itself, keyed by project root (`undefined` for the user-level only pass). */
  readonly load: (projectRoot: string | undefined) => Promise<T>
}

/** The memoised read model handed to a service face. */
export interface LazyLoad<T> {
  /** The memoised load for one query, sharing the in-flight work with its peers. */
  forQuery(cwd: string | undefined, signal: AbortSignal | undefined): Promise<T>
  /** Drop every memoised load; the next query reloads. */
  invalidate(): void
}

/** Create the lazy loader. Callers bind its two methods onto their service face. */
export function createLazyLoad<T>(options: LazyLoadOptions<T>): LazyLoad<T> {
  const cache = new Map<string, Promise<T>>()

  return {
    async forQuery(cwd, signal) {
      signal?.throwIfAborted()
      // Resolved once per query: the memo key and the work must describe the same project.
      const projectRoot = cwd === undefined ? undefined : await options.resolveProjectRoot(cwd)
      const key = projectRoot ?? NO_PROJECT_ROOT_KEY
      let pending = cache.get(key)
      if (pending === undefined) {
        pending = options.load(projectRoot)
        pending.catch(() => {
          if (cache.get(key) === pending) cache.delete(key)
        })
        cache.set(key, pending)
      }
      const result = await pending
      signal?.throwIfAborted()
      return result
    },
    invalidate() {
      cache.clear()
    },
  }
}
