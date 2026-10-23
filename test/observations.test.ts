import { describe, expect, it } from 'vitest'

import type { ChainObservations, ModelDefinition } from '../src/contract/types.ts'
import {
  DEGRADED_FAILURES,
  RATE_LIMIT_STREAK,
  RATE_LIMIT_WINDOW_MS,
  routeKey,
  withAvailability,
} from '../src/core/resolve/observations.ts'

function model(modelName: string, overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return { modelName, provider: 'deepseek', model: `model-${modelName}`, available: true, source: 'user-dsh', ...overrides }
}

function ledger(...routes: ChainObservations['routes']): ChainObservations {
  return { routes }
}

/** A route observation with only the counters a case cares about. */
function record(provider: string, modelId: string, counters: { failures?: number; rateLimitStreak?: number; rateLimitSince?: number } = {}) {
  return { route: { provider, model: modelId }, ...counters }
}

const NOW = 1_000_000

function healths(models: readonly ModelDefinition[], observations?: ChainObservations, now?: number) {
  return withAvailability({ models }, observations, now).map((entry) => [entry.modelName, entry.health])
}

describe('routeKey', () => {
  it('keys a route by its exact provider/model pair, without join ambiguity', () => {
    expect(routeKey({ provider: 'deepseek', model: 'deepseek-chat' })).toBe(routeKey({ provider: 'deepseek', model: 'deepseek-chat' }))
    expect(routeKey({ provider: 'deepseek', model: 'deepseek-chat' })).not.toBe(routeKey({ provider: 'deepseek-account', model: 'deepseek-chat' }))
    // provider "a" + model "b/c" must not collide with provider "a/b" + model "c".
    expect(routeKey({ provider: 'a', model: 'b/c' })).not.toBe(routeKey({ provider: 'a/b', model: 'c' }))
  })
})

describe('availability projection (R2 §3.2)', () => {
  it('projects the whole snapshot to active when there is no ledger', () => {
    expect(healths([model('a'), model('b')])).toEqual([['a', 'active'], ['b', 'active']])
    expect(healths([model('a'), model('b')], ledger())).toEqual([['a', 'active'], ['b', 'active']])
  })

  it('keeps every field of the entry, adding only health', () => {
    const entry = model('a', { sysPrompt: 'be terse', path: '/tmp/registry.yaml', synthesized: true })
    const [projected] = withAvailability({ models: [entry] }, undefined, undefined)

    expect(projected).toEqual({ ...entry, health: 'active' })
    expect(projected?.available).toBe(true)
  })

  it('projects available:false to disabled and never rewrites available', () => {
    const off = model('a', { available: false })
    const [projected] = withAvailability({ models: [off] }, undefined, undefined)

    expect(projected?.health).toBe('disabled')
    expect(projected?.available).toBe(false)
    expect(off.available).toBe(false)
  })

  it('lets the configuration switch win over the ledger', () => {
    const off = model('a', { available: false })

    expect(healths([off], ledger(record('deepseek', 'model-a', { failures: 9, rateLimitStreak: 9, rateLimitSince: NOW })), NOW)).toEqual([['a', 'disabled']])
  })

  it(`degrades a route at ${DEGRADED_FAILURES} same-class failures, not at one`, () => {
    expect(healths([model('a')], ledger(record('deepseek', 'model-a', { failures: 1 })), NOW)).toEqual([['a', 'active']])
    expect(healths([model('a')], ledger(record('deepseek', 'model-a', { failures: DEGRADED_FAILURES })), NOW)).toEqual([['a', 'degraded']])
    expect(healths([model('a')], ledger(record('deepseek', 'model-a', { failures: 5 })), NOW)).toEqual([['a', 'degraded']])
  })

  it('degrades a sustained rate-limit streak only while it is inside the window', () => {
    const streak = (rateLimitSince: number) => ledger(record('deepseek', 'model-a', { rateLimitStreak: RATE_LIMIT_STREAK, rateLimitSince }))

    expect(healths([model('a')], streak(NOW - RATE_LIMIT_WINDOW_MS), NOW)).toEqual([['a', 'degraded']])
    expect(healths([model('a')], streak(NOW - RATE_LIMIT_WINDOW_MS - 1), NOW)).toEqual([['a', 'active']])
    expect(healths([model('a')], streak(NOW), NOW)).toEqual([['a', 'degraded']])
  })

  it('needs both the streak count and the clock: either one missing judges nothing', () => {
    const short = ledger(record('deepseek', 'model-a', { rateLimitStreak: RATE_LIMIT_STREAK - 1, rateLimitSince: NOW }))
    const unclocked = ledger(record('deepseek', 'model-a', { rateLimitStreak: RATE_LIMIT_STREAK, rateLimitSince: NOW }))
    const undated = ledger(record('deepseek', 'model-a', { rateLimitStreak: RATE_LIMIT_STREAK }))

    expect(healths([model('a')], short, NOW)).toEqual([['a', 'active']])
    expect(healths([model('a')], unclocked, undefined)).toEqual([['a', 'active']])
    expect(healths([model('a')], undated, NOW)).toEqual([['a', 'active']])
  })

  it('keys the ledger by route, so two entries of the same pair share one health', () => {
    const models = [
      model('official', { provider: 'deepseek', model: 'deepseek-reasoner' }),
      model('account', { provider: 'deepseek-account', model: 'deepseek-reasoner' }),
    ]

    expect(healths(models, ledger(record('deepseek', 'deepseek-reasoner', { failures: 2 })), NOW)).toEqual([
      ['official', 'degraded'],
      ['account', 'active'],
    ])
  })

  it('ignores ledger rows for routes the snapshot does not have', () => {
    expect(healths([model('a')], ledger(record('elsewhere', 'model-a', { failures: 9 })), NOW)).toEqual([['a', 'active']])
  })

  it('folds a duplicated row to its highest count instead of hiding a failure', () => {
    const models = [model('a')]

    expect(healths(models, ledger(record('deepseek', 'model-a', { failures: 2 }), record('deepseek', 'model-a', { failures: 0 })), NOW)).toEqual([['a', 'degraded']])
    expect(healths(models, ledger(record('deepseek', 'model-a', { failures: 0 }), record('deepseek', 'model-a', { failures: 2 })), NOW)).toEqual([['a', 'degraded']])
  })

  it('keeps the entry order and never mutates the snapshot', () => {
    const models = [model('b'), model('a'), model('off', { available: false })]
    const frozen = { models }

    const projected = withAvailability(frozen, ledger(record('deepseek', 'model-a', { failures: 2 })), NOW)

    expect(projected.map((entry) => entry.modelName)).toEqual(['b', 'a', 'off'])
    expect(projected.map((entry) => entry.health)).toEqual(['active', 'degraded', 'disabled'])
    expect(models.every((entry) => !('health' in entry))).toBe(true)
  })

  it('is deterministic and total', () => {
    const observations: ChainObservations = ledger(
      record('deepseek', 'model-a', { failures: 2 }),
      { route: { provider: 'deepseek', model: 'model-b' }, failures: Number.NaN, rateLimitStreak: -1 },
    )
    const run = () => withAvailability({ models: [model('a'), model('b')] }, observations, NOW)

    expect(run()).toEqual(run())
    expect(run().map((entry) => entry.health)).toEqual(['degraded', 'active'])
  })
})
