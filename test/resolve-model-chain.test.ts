import { describe, expect, it } from 'vitest'

import type {
  AgentChainInput,
  AliasRegistrySnapshot,
  ChainObservations,
  ChainResolutionInput,
  ChainResolutionReport,
  ModelDefinition,
  ModelSelectionPolicy,
  RouteObservation,
} from '../src/contract/types.ts'
import { resolveModelChain, routeKeyOf, type ChainResolutionContext } from '../src/core/resolve/model-chain.ts'
import { withAvailability } from '../src/core/resolve/observations.ts'

/**
 * Entry names follow the spec's own example (`ds-chat` → `deepseek-chat`), so
 * every assertion can tell the registry entry apart from the model id it names.
 */
const MODELS: Readonly<Record<string, string>> = {
  'ds-chat': 'deepseek-chat',
  'ds-reasoner': 'deepseek-reasoner',
  'ds-fast': 'deepseek-fast',
  a: 'model-a',
  b: 'model-b',
  c: 'model-c',
}

function model(modelName: string, overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return { modelName, provider: 'deepseek', model: MODELS[modelName] ?? modelName, available: true, source: 'user-dsh', ...overrides }
}

function snapshot(entries: { models?: readonly ModelDefinition[]; aliases?: readonly { alias: string; targets: readonly string[] }[] }): AliasRegistrySnapshot {
  return {
    models: entries.models ?? [],
    aliases: (entries.aliases ?? []).map((entry) => ({ ...entry, source: 'user-dsh' as const })),
  }
}

function agent(overrides: Partial<ChainResolutionInput> = {}): ChainResolutionInput {
  return { agentName: 'reviewer', body: 'You review code.', ...overrides }
}

function resolve(context: Partial<ChainResolutionContext> & Pick<ChainResolutionContext, 'agent' | 'snapshot'>) {
  return resolveModelChain(context)
}

/** Narrowing helper: the test wants a success and should fail loudly otherwise. */
function success(context: Parameters<typeof resolveModelChain>[0]) {
  const result = resolveModelChain(context)
  if (!result.ok) throw new Error(`expected success, got failure: ${result.message}`)
  return result
}

function reportOf(context: Parameters<typeof resolveModelChain>[0]): ChainResolutionReport {
  return resolveModelChain(context).report
}

const baseSnapshot = snapshot({
  models: [model('ds-chat'), model('ds-reasoner'), model('ds-fast')],
  aliases: [
    { alias: 'smart', targets: ['ds-reasoner'] },
    { alias: 'fast', targets: ['ds-fast'] },
    { alias: 'chat', targets: ['ds-chat'] },
  ],
})

describe('alias chain resolution', () => {
  it('picks the first alias in declaration order, not the first in the registry', () => {
    const result = success({ agent: agent({ modelOrder: ['fast', 'smart'] }), snapshot: baseSnapshot })

    expect([result.provider, result.model]).toEqual(['deepseek', 'deepseek-fast'])
    expect(result.report.selectedBy).toBe('alias')
    // Every link of the chain is reported: the winner's row has no skip, and the
    // link after it says plainly that the chain never got there.
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-fast' }, origin: 'alias', modelName: 'ds-fast', orderIndex: 0 },
      { route: { provider: 'deepseek', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'ds-reasoner', orderIndex: 1, skipped: 'not-reached' },
    ])
    expect(result.report.aliasChain.map((step) => step.modelName)).toEqual(['ds-fast', undefined])
  })

  it('resolves an alias through its model entry, keeping the entry name in the report', () => {
    const result = success({ agent: agent({ modelOrder: ['smart'] }), snapshot: baseSnapshot })

    expect(result.report.aliasChain).toEqual([
      { orderIndex: 0, alias: 'smart', targets: ['ds-reasoner'], modelName: 'ds-reasoner' },
    ])
    expect([result.provider, result.model]).toEqual(['deepseek', 'deepseek-reasoner'])
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'ds-reasoner', orderIndex: 0 },
    ])
  })

  it('skips available:false entries, keeps walking, and reports the skip reason', () => {
    const entries = snapshot({
      models: [model('ds-reasoner', { available: false }), model('ds-chat')],
      aliases: [{ alias: 'smart', targets: ['ds-reasoner'] }, { alias: 'chat', targets: ['ds-chat'] }],
    })

    const result = success({ agent: agent({ modelOrder: ['smart', 'chat'] }), snapshot: entries })

    expect(result.model).toBe('deepseek-chat')
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'ds-reasoner', orderIndex: 0, skipped: 'unavailable' },
      { route: { provider: 'deepseek', model: 'deepseek-chat' }, origin: 'alias', modelName: 'ds-chat', orderIndex: 1 },
    ])
    // The skipped alias still shows up in the alias half of the report.
    expect(result.report.aliasChain.map((step) => [step.alias, step.modelName])).toEqual([
      ['smart', undefined],
      ['chat', 'ds-chat'],
    ])
  })

  it('skips an unknown alias and continues with the next one', () => {
    const result = success({ agent: agent({ modelOrder: ['missing', 'chat'] }), snapshot: baseSnapshot })

    expect(result.model).toBe('deepseek-chat')
    expect(result.report.aliasChain[0]).toEqual({ orderIndex: 0, alias: 'missing', targets: [], skipped: 'unknown-alias' })
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-chat' }, origin: 'alias', modelName: 'ds-chat', orderIndex: 1 },
    ])
  })

  it('skips an alias whose target entry is missing', () => {
    const entries = snapshot({ models: [model('ds-chat')], aliases: [{ alias: 'ghost', targets: ['nowhere'] }, { alias: 'chat', targets: ['ds-chat'] }] })

    const result = success({ agent: agent({ modelOrder: ['ghost', 'chat'] }), snapshot: entries })

    expect(result.model).toBe('deepseek-chat')
    expect(result.report.candidates[0]).toEqual({ origin: 'alias', modelName: 'nowhere', orderIndex: 0, skipped: 'unknown-model' })
    expect(result.report.aliasChain[0]).toEqual({ orderIndex: 0, alias: 'ghost', targets: ['nowhere'] })
  })

  it('walks every target of a pooled alias before moving on', () => {
    const entries = snapshot({
      models: [model('a', { available: false }), model('b'), model('c')],
      aliases: [{ alias: 'pool', targets: ['a', 'b'] }, { alias: 'c-alias', targets: ['c'] }],
    })

    const result = success({ agent: agent({ modelOrder: ['pool', 'c-alias'] }), snapshot: entries })

    expect(result.model).toBe('model-b')
    expect(result.report.aliasChain[0]?.modelName).toBe('b')
  })
})

describe('raw fallback', () => {
  it('uses the legacy model array when modelOrder is exhausted', () => {
    const result = success({
      agent: agent({ modelOrder: ['smart'], model: [{ provider: 'local', model: 'llama' }] }),
      snapshot: snapshot({ models: [model('ds-reasoner', { available: false })], aliases: [{ alias: 'smart', targets: ['ds-reasoner'] }] }),
    })

    expect([result.provider, result.model]).toEqual(['local', 'llama'])
    expect(result.report.selectedBy).toBe('raw')
    expect(result.report.rawFallbackUsed).toBe(true)
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'ds-reasoner', orderIndex: 0, skipped: 'unavailable' },
      { route: { provider: 'local', model: 'llama' }, origin: 'raw' },
    ])
  })

  it('follows the raw array order and skips disallowed raw entries', () => {
    const policy: ModelSelectionPolicy = { routes: [{ provider: 'local', model: 'second' }] }
    const result = success({
      agent: agent({ model: [{ provider: 'local', model: 'first' }, { provider: 'local', model: 'second' }] }),
      snapshot: snapshot({}),
      policy,
    })

    expect(result.model).toBe('second')
    expect(result.report.candidates).toEqual([
      { route: { provider: 'local', model: 'first' }, origin: 'raw', skipped: 'not-allowed' },
      { route: { provider: 'local', model: 'second' }, origin: 'raw' },
    ])
  })

  it('prefers an allowed alias over an earlier-declared raw entry', () => {
    const result = success({
      agent: agent({ modelOrder: ['chat'], model: [{ provider: 'local', model: 'llama' }] }),
      snapshot: baseSnapshot,
    })

    expect([result.provider, result.model]).toEqual(['deepseek', 'deepseek-chat'])
    expect(result.report.rawFallbackUsed).toBe(true)
  })
})

describe('whitelist', () => {
  const policy: ModelSelectionPolicy = { routes: [{ provider: 'deepseek', model: 'deepseek-chat' }, { provider: 'local', model: 'llama' }] }

  it('refuses an alias route outside the allowed routes', () => {
    const result = success({ agent: agent({ modelOrder: ['smart', 'chat'] }), snapshot: baseSnapshot, policy })

    expect(result.model).toBe('deepseek-chat')
    expect(result.report.candidates[0]).toMatchObject({ modelName: 'ds-reasoner', skipped: 'not-allowed' })
  })

  it('applies the allowlist to raw entries too', () => {
    const result = success({
      agent: agent({ model: [{ provider: 'local', model: 'llama' }] }),
      snapshot: snapshot({}),
      policy,
    })

    expect(result.model).toBe('llama')
  })

  it('treats a fully refused chain as exhausted, like unavailable', () => {
    const result = resolve({ agent: agent({ modelOrder: ['smart'], model: [{ provider: 'local', model: 'nope' }] }), snapshot: baseSnapshot, policy })

    expect(result.ok).toBe(false)
    expect(result.report.candidates.map((candidate) => candidate.skipped)).toEqual(['not-allowed', 'not-allowed'])
  })

  it('treats an empty routes array as allowing nothing', () => {
    const result = resolve({ agent: agent({ modelOrder: ['chat'] }), snapshot: baseSnapshot, policy: { routes: [] } })

    expect(result.ok).toBe(false)
  })

  it('treats an absent policy (or absent routes) as allowing everything', () => {
    expect(success({ agent: agent({ modelOrder: ['smart'] }), snapshot: baseSnapshot, policy: {} }).model).toBe('deepseek-reasoner')
    expect(success({ agent: agent({ modelOrder: ['smart'] }), snapshot: baseSnapshot, policy: undefined }).model).toBe('deepseek-reasoner')
  })

  it('checks availability before the allowlist', () => {
    const entries = snapshot({ models: [model('ds-reasoner', { available: false })], aliases: [{ alias: 'smart', targets: ['ds-reasoner'] }] })

    const result = resolve({ agent: agent({ modelOrder: ['smart'] }), snapshot: entries, policy: { routes: [] } })

    expect(result.ok).toBe(false)
    expect(result.report.candidates[0]?.skipped).toBe('unavailable')
  })
})

describe('chain exhaustion', () => {
  it('answers a hard error whose message echoes the whole chain', () => {
    const entries = snapshot({
      models: [model('ds-reasoner', { available: false }), model('ds-chat', { available: false })],
      aliases: [{ alias: 'smart', targets: ['ds-reasoner'] }, { alias: 'chat', targets: ['ds-chat'] }],
    })

    const result = resolve({
      agent: agent({ agentName: 'planner', modelOrder: ['smart', 'nope', 'chat'], model: [{ provider: 'local', model: 'llama' }] }),
      snapshot: entries,
      policy: { routes: [{ provider: 'x', model: 'y' }] },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('chain-exhausted')
    // Every link of the chain, in document order, with each one's verdict.
    expect(result.message).toContain('agent "planner"')
    expect(result.message).toContain('modelOrder[0] smart → ds-reasoner (deepseek/deepseek-reasoner): unavailable')
    expect(result.message).toContain('modelOrder[1] nope: unknown-alias')
    expect(result.message).toContain('modelOrder[2] chat → ds-chat (deepseek/deepseek-chat): unavailable')
    expect(result.message).toContain('model[0]: raw local/llama: not-allowed')
    expect(result.report.aliasChain.map((step) => step.alias)).toEqual(['smart', 'nope', 'chat'])
  })

  it('errors on an empty chain and says so', () => {
    const result = resolve({ agent: agent({ agentName: 'blank' }), snapshot: snapshot({}) })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('agent "blank"')
    expect(result.message).toContain('neither modelOrder aliases nor model entries are declared')
    expect(result.report.candidates).toEqual([])
  })

  it('carries the report alongside the error, not instead of it', () => {
    const result = resolve({ agent: agent({ modelOrder: ['chat'] }), snapshot: snapshot({}) })

    expect(result.ok).toBe(false)
    expect(result.report.aliasChain).toEqual([{ orderIndex: 0, alias: 'chat', targets: [], skipped: 'unknown-alias' }])
    expect(result.report.candidates).toEqual([])
  })

  it('never throws, whatever the document and the registry say', () => {
    const cases: ChainResolutionContext[] = [
      { agent: agent({ modelOrder: [] }), snapshot: snapshot({}) },
      { agent: agent({ model: [{ provider: '', model: '' }] }), snapshot: snapshot({}) },
      { agent: agent({ modelOrder: ['a'] }), snapshot: snapshot({ models: [model('m', { available: false })], aliases: [{ alias: 'a', targets: ['m', 'm'] }] }) },
    ]
    for (const context of cases) expect(() => resolveModelChain(context)).not.toThrow()
  })
})

describe('effort precedence (D7)', () => {
  it('uses the chain item effort over the agent default', () => {
    const result = success({
      agent: agent({ modelOrder: ['smart'], reasoningEffort: 'low' }),
      snapshot: baseSnapshot,
      itemEffort: { 'ds-reasoner': 'high' },
    })

    expect(result.reasoningEffort).toBe('high')
    expect(result.report.effortSource).toBe('chain')
  })

  it('falls back to the agent default when the chain item has none', () => {
    const result = success({
      agent: agent({ modelOrder: ['smart'], reasoningEffort: 'medium' }),
      snapshot: baseSnapshot,
    })

    expect(result.reasoningEffort).toBe('medium')
    expect(result.report.effortSource).toBe('agent')
  })

  it('omits the effort entirely when neither layer supplies one', () => {
    const result = success({ agent: agent({ modelOrder: ['smart'] }), snapshot: baseSnapshot })

    expect('reasoningEffort' in result).toBe(false)
    expect(result.report.effortSource).toBe('none')
  })

  it('ignores item effort for a raw winner (it is keyed by model entry)', () => {
    const result = success({
      agent: agent({ model: [{ provider: 'deepseek', model: 'deepseek-chat' }] }),
      snapshot: baseSnapshot,
      itemEffort: { 'ds-chat': 'high' },
    })

    expect('reasoningEffort' in result).toBe(false)
    expect(result.report.effortSource).toBe('none')
  })

  it('does not invent an effort for the failure result', () => {
    const result = resolve({ agent: agent({ modelOrder: ['chat'], reasoningEffort: 'high' }), snapshot: snapshot({}) })

    expect(result.ok).toBe(false)
    expect('reasoningEffort' in result).toBe(false)
    expect(result.report.effortSource).toBe('none')
  })
})

describe('session-start payload', () => {
  it('passes the persona through untouched', () => {
    const body = 'You review code.\n\n  Accept trailing spaces.  '
    const result = success({ agent: agent({ modelOrder: ['chat'], body }), snapshot: baseSnapshot })

    expect(result.persona).toBe(body)
  })

  it('returns the required tools as the tool filter, and an empty one when none are declared', () => {
    expect(success({ agent: agent({ modelOrder: ['chat'], requiredTools: ['read', 'grep'] }), snapshot: baseSnapshot }).toolFilter).toEqual(['read', 'grep'])
    expect(success({ agent: agent({ modelOrder: ['chat'] }), snapshot: baseSnapshot }).toolFilter).toEqual([])
  })

  it('resolves flavor: call-site override, then the document, then spawn', () => {
    expect(success({ agent: agent({ modelOrder: ['chat'], spawn: 'fork' }), snapshot: baseSnapshot }).flavor).toBe('fork')
    expect(success({ agent: agent({ modelOrder: ['chat'], spawn: 'fork' }), snapshot: baseSnapshot, flavor: 'spawn' }).flavor).toBe('spawn')
    expect(success({ agent: agent({ modelOrder: ['chat'] }), snapshot: baseSnapshot }).flavor).toBe('spawn')
  })
})

describe('resolution report', () => {
  it('is deterministic: same input, same report', () => {
    const context: ChainResolutionContext = {
      agent: agent({ modelOrder: ['smart', 'chat'], model: [{ provider: 'local', model: 'llama' }] }),
      snapshot: snapshot({
        models: [model('ds-reasoner', { available: false }), model('ds-chat')],
        aliases: [{ alias: 'smart', targets: ['ds-reasoner'] }, { alias: 'chat', targets: ['ds-chat'] }],
      }),
      policy: { routes: [{ provider: 'deepseek', model: 'deepseek-chat' }] },
    }

    expect(reportOf(context)).toEqual(reportOf(context))
    expect(reportOf(context)).toEqual({
      aliasChain: [
        { orderIndex: 0, alias: 'smart', targets: ['ds-reasoner'] },
        { orderIndex: 1, alias: 'chat', targets: ['ds-chat'], modelName: 'ds-chat' },
      ],
      rawFallbackUsed: true,
      candidates: [
        { route: { provider: 'deepseek', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'ds-reasoner', orderIndex: 0, skipped: 'unavailable' },
        { route: { provider: 'deepseek', model: 'deepseek-chat' }, origin: 'alias', modelName: 'ds-chat', orderIndex: 1 },
        { route: { provider: 'local', model: 'llama' }, origin: 'raw', skipped: 'not-reached' },
      ],
      selectedBy: 'alias',
      effortSource: 'none',
    })
  })

  it('flags the escape hatch whenever a raw chain is declared, used or not', () => {
    const withRaw = reportOf({ agent: agent({ modelOrder: ['chat'], model: [{ provider: 'local', model: 'llama' }] }), snapshot: baseSnapshot })
    const withoutRaw = reportOf({ agent: agent({ modelOrder: ['chat'] }), snapshot: baseSnapshot })

    expect(withRaw.rawFallbackUsed).toBe(true)
    expect(withoutRaw.rawFallbackUsed).toBe(false)
  })

  it('does not touch the injected snapshot', () => {
    const frozen = snapshot({ models: [model('ds-chat')], aliases: [{ alias: 'chat', targets: ['ds-chat'] }] })
    const context = { agent: agent({ modelOrder: ['chat'] }), snapshot: frozen }

    resolveModelChain(context)

    expect(frozen.aliases[0]?.targets).toEqual(['ds-chat'])
    expect(Object.keys(frozen.aliases[0] ?? {})).toEqual(['alias', 'targets', 'source'])
  })
})

describe('failure ledger (ticket 03 enhancement / #33)', () => {
  /** Two provider lines of one model, plus a second model — the shape a pool has. */
  const pooled = snapshot({
    models: [
      model('reasoner-official', { provider: 'deepseek', model: 'deepseek-reasoner' }),
      model('reasoner-account', { provider: 'deepseek-account', model: 'deepseek-reasoner' }),
      model('chat', { provider: 'deepseek', model: 'deepseek-chat' }),
      model('retired', { provider: 'deepseek', model: 'deepseek-retired', available: false }),
    ],
    aliases: [
      { alias: 'smart', targets: ['reasoner-official', 'reasoner-account'] },
      { alias: 'chatty', targets: ['chat'] },
      { alias: 'old', targets: ['retired'] },
    ],
  })

  const NOW = 1_750_000_000_000
  const failed = (provider: string, modelId: string, failures: number): RouteObservation => ({ route: { provider, model: modelId }, failures })

  it('reports exactly what it reported before when no ledger is injected', () => {
    const context: ChainResolutionContext = {
      agent: agent({ modelOrder: ['smart', 'old'], model: [{ provider: 'local', model: 'llama' }], reasoningEffort: 'high' }),
      snapshot: pooled,
    }

    const before = success(context)
    const withoutLedger = success({ ...context, observations: undefined, now: NOW })

    expect(withoutLedger).toEqual(before)
    expect(withoutLedger.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'reasoner-official', orderIndex: 0 },
      { route: { provider: 'deepseek-account', model: 'deepseek-reasoner' }, origin: 'alias', modelName: 'reasoner-account', orderIndex: 0, skipped: 'not-reached' },
      // The first target of `smart` resolved, so nothing after it was even tried —
      // not the disabled `old`, not the raw fallback: the pre-R2 reading, unchanged.
      { route: { provider: 'deepseek', model: 'deepseek-retired' }, origin: 'alias', modelName: 'retired', orderIndex: 1, skipped: 'not-reached' },
      { route: { provider: 'local', model: 'llama' }, origin: 'raw', skipped: 'not-reached' },
    ])
    // The exact-key discipline: no candidate row grew a 'health' key.
    expect(withoutLedger.report.candidates.some((candidate) => 'health' in candidate)).toBe(false)
    expect(reportOf({ ...context, observations: undefined, now: NOW })).toEqual(reportOf(context))
  })

  it('leaves the projected snapshot alone: no health borrowed, no reordering from it', () => {
    const observations: ChainObservations = {
      routes: [
        failed('deepseek', 'deepseek-reasoner', 2),
        { route: { provider: 'deepseek', model: 'deepseek-chat' }, rateLimitStreak: 3, rateLimitSince: NOW - 1_000 },
      ],
    }
    const context: ChainResolutionContext = { agent: agent({ modelOrder: ['smart', 'chatty'] }), snapshot: pooled }

    const routes = (report: ChainResolutionReport) => report.candidates.map((candidate) => [candidate.modelName, candidate.skipped])
    const withLedger = success({ ...context, observations, now: NOW })
    const projected = success({ ...context, snapshot: { ...pooled, models: withAvailability(pooled, observations, NOW) } })

    // A snapshot is not a ledger: the engine writes no `health` from one, and
    // does not reorder from one, so the pre-projection winner stands where
    // declaration put it (see the ticket's drift list). The ledger path demotes.
    expect(projected.report.candidates.map((candidate) => 'health' in candidate)).toEqual([false, false, false])
    expect(routes(projected.report)[0]).toEqual(['reasoner-official', undefined])
    expect(routes(withLedger.report)[0]).toEqual(['reasoner-account', undefined])
    expect(withLedger.report.candidates.map((candidate) => [candidate.modelName, candidate.health])).toEqual([
      ['reasoner-account', 'active'],
      ['reasoner-official', 'degraded'],
      ['chat', 'degraded'],
    ])
    expect(routes(projected.report)[0]).toEqual(['reasoner-official', undefined])
    expect(routes(withLedger.report)[0]).toEqual(['reasoner-account', undefined])
    expect(projected.report.selectedBy).toBe(withLedger.report.selectedBy)
  })

  it('demotes a degraded candidate behind its active pool siblings and picks the sibling', () => {
    const entries = snapshot({
      models: [
        model('a', { provider: 'deepseek', model: 'model-a' }),
        model('b', { provider: 'deepseek-account', model: 'model-a' }),
      ],
      aliases: [{ alias: 'pool', targets: ['a', 'b'] }],
    })

    const result = success({
      agent: agent({ modelOrder: ['pool'] }),
      snapshot: entries,
      observations: { routes: [failed('deepseek', 'model-a', 2)] },
      now: NOW,
    })

    expect(result.provider).toBe('deepseek-account')
    expect(result.report.candidates.map((candidate) => [candidate.modelName, candidate.health, candidate.skipped])).toEqual([
      ['b', 'active', undefined],
      ['a', 'degraded', 'not-reached'],
    ])
  })

  it('keeps declaration order inside each health layer', () => {
    const entries = snapshot({
      models: [model('a'), model('b'), model('c')],
      aliases: [{ alias: 'pool', targets: ['a', 'b', 'c'] }],
    })

    const result = success({
      agent: agent({ modelOrder: ['pool'] }),
      snapshot: entries,
      observations: { routes: [failed('deepseek', 'model-a', 2), failed('deepseek', 'model-c', 2)] },
      now: NOW,
    })

    expect(result.report.candidates.map((candidate) => candidate.modelName)).toEqual(['b', 'a', 'c'])
  })

  it('demotes only within the pool: an earlier alias still supplies the winner', () => {
    const result = success({
      agent: agent({ modelOrder: ['smart', 'chatty'] }),
      snapshot: pooled,
      observations: { routes: [failed('deepseek', 'deepseek-reasoner', 2)] },
      now: NOW,
    })

    // 'smart' still carries the chain's first survivor — its healthy sibling line,
    // not the later alias: degradation reorders a pool, it never lets a later
    // alias overtake an earlier one.
    expect([result.provider, result.model]).toEqual(['deepseek-account', 'deepseek-reasoner'])
    expect(result.report.aliasChain.map((step) => step.modelName)).toEqual(['reasoner-account', undefined])
    // Each pool in layer order — `smart`'s degraded line behind its healthy one,
    // then the later alias, then `old`, which is still skipped out of the pool
    // altogether. The raw tail was never even reached.
    expect(result.report.candidates.map((candidate) => [candidate.modelName, candidate.health, candidate.skipped])).toEqual([
      ['reasoner-account', 'active', undefined],
      ['chat', 'active', 'not-reached'],
      ['reasoner-official', 'degraded', 'not-reached'],
    ])
  })

  it('still skips a disabled candidate as unavailable, keeping the ledger off the switch', () => {
    const result = resolve({
      agent: agent({ modelOrder: ['old'] }),
      snapshot: pooled,
      observations: { routes: [failed('deepseek', 'deepseek-retired', 0)] },
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'deepseek-retired' }, origin: 'alias', modelName: 'retired', orderIndex: 0, skipped: 'unavailable', health: 'disabled' },
    ])
    expect(pooled.models.find((entry) => entry.modelName === 'retired')?.available).toBe(false)
  })

  it('keeps the ledger health of a not-allowed candidate while still refusing it', () => {
    const entries = snapshot({ models: [model('a')], aliases: [{ alias: 'pool', targets: ['a'] }] })

    const result = resolve({
      agent: agent({ modelOrder: ['pool'] }),
      snapshot: entries,
      policy: { routes: [{ provider: 'x', model: 'y' }] },
      observations: { routes: [failed('deepseek', 'model-a', 2)] },
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.report.candidates).toEqual([
      { route: { provider: 'deepseek', model: 'model-a' }, origin: 'alias', modelName: 'a', orderIndex: 0, skipped: 'not-allowed', health: 'degraded' },
    ])
  })

  it('R1-C: the alias step names the candidate that won, not the first of its pool', () => {
    // The pool's head is disabled: it is skipped first, and the alias resolves
    // through the sibling — which is the entry the step must name.
    const entries = snapshot({
      models: [model('a', { available: false }), model('b')],
      aliases: [{ alias: 'pool', targets: ['a', 'b'] }],
    })

    const result = success({ agent: agent({ modelOrder: ['pool'] }), snapshot: entries })

    expect(result.model).toBe('model-b')
    expect(result.report.aliasChain).toEqual([{ orderIndex: 0, alias: 'pool', targets: ['a', 'b'], modelName: 'b' }])
  })

  it('R1-C: a degraded head does not name the step either', () => {
    const entries = snapshot({ models: [model('a'), model('b')], aliases: [{ alias: 'pool', targets: ['a', 'b'] }] })

    const result = success({
      agent: agent({ modelOrder: ['pool'] }),
      snapshot: entries,
      observations: { routes: [failed('deepseek', 'model-a', 2)] },
      now: NOW,
    })

    expect(result.report.aliasChain[0]?.modelName).toBe('b')
  })
})

describe('effort supportability (R2 §2.7-2)', () => {
  const entries = snapshot({
    models: [
      model('strong', { provider: 'deepseek', model: 'deepseek-reasoner' }),
      model('plain', { provider: 'deepseek', model: 'deepseek-chat' }),
    ],
    aliases: [
      { alias: 'strong', targets: ['strong'] },
      { alias: 'plain', targets: ['plain'] },
    ],
  })

  const supports = (...pairs: [provider: string, modelId: string, efforts: readonly string[]][]) =>
    Object.fromEntries(pairs.map(([provider, modelId, efforts]) => [routeKeyOf({ provider, model: modelId }), efforts]))

  it('skips an unsupported target and moves on within the pipeline', () => {
    const result = success({
      agent: agent({ modelOrder: ['strong', 'plain'], reasoningEffort: 'high' }),
      snapshot: entries,
      supportedEfforts: supports(['deepseek', 'deepseek-reasoner', ['low', 'medium']], ['deepseek', 'deepseek-chat', ['high']]),
    })

    expect(result.model).toBe('deepseek-chat')
    expect(result.reasoningEffort).toBe('high')
    expect(result.report.candidates.map((candidate) => [candidate.modelName, candidate.skipped])).toEqual([
      ['strong', 'unsupported-effort'],
      ['plain', undefined],
    ])
    // The skipped alias resolves nothing, so its step stays unnamed.
    expect(result.report.aliasChain.map((step) => step.modelName)).toEqual([undefined, 'plain'])
  })

  it('judges by the chain item effort when it overrides the agent default', () => {
    const refused = resolve({
      agent: agent({ modelOrder: ['strong'], reasoningEffort: 'low' }),
      snapshot: entries,
      itemEffort: { strong: 'high' },
      supportedEfforts: supports(['deepseek', 'deepseek-reasoner', ['low']]),
    })
    const accepted = success({
      agent: agent({ modelOrder: ['plain'], reasoningEffort: 'high' }),
      snapshot: entries,
      itemEffort: { plain: 'low' },
      supportedEfforts: supports(['deepseek', 'deepseek-chat', ['low']]),
    })

    expect(refused.report.candidates[0]?.skipped).toBe('unsupported-effort')
    expect(accepted.model).toBe('deepseek-chat')
    expect(accepted.reasoningEffort).toBe('low')
  })

  it('treats a route with no table row as capability-unknown, never as refused', () => {
    const result = success({
      agent: agent({ modelOrder: ['strong'], reasoningEffort: 'high' }),
      snapshot: entries,
      supportedEfforts: supports(['deepseek', 'deepseek-chat', []]),
    })

    expect(result.model).toBe('deepseek-reasoner')
  })

  it('judges nothing without a table, or without an effort to judge', () => {
    const noTable = success({ agent: agent({ modelOrder: ['strong'], reasoningEffort: 'high' }), snapshot: entries })
    const noEffort = success({
      agent: agent({ modelOrder: ['strong'] }),
      snapshot: entries,
      supportedEfforts: supports(['deepseek', 'deepseek-reasoner', []]),
    })

    expect(noTable.model).toBe('deepseek-reasoner')
    expect(noEffort.model).toBe('deepseek-reasoner')
    expect(noEffort.report.effortSource).toBe('none')
  })

  it('applies to the raw escape hatch through the same pipeline', () => {
    const result = success({
      agent: agent({ model: [{ provider: 'local', model: 'llama' }, { provider: 'local', model: 'qwen' }], reasoningEffort: 'high' }),
      snapshot: snapshot({}),
      supportedEfforts: supports(['local', 'llama', ['low']]),
    })

    expect(result.model).toBe('qwen')
    expect(result.report.candidates).toEqual([
      { route: { provider: 'local', model: 'llama' }, origin: 'raw', skipped: 'unsupported-effort' },
      { route: { provider: 'local', model: 'qwen' }, origin: 'raw' },
    ])
  })

  it('never rewrites the effort to make a route fit: the chain just runs out', () => {
    const result = resolve({
      agent: agent({ modelOrder: ['strong'], reasoningEffort: 'high' }),
      snapshot: entries,
      supportedEfforts: supports(['deepseek', 'deepseek-reasoner', ['low']]),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect('reasoningEffort' in result).toBe(false)
    expect(result.message).toContain('modelOrder[0] strong → strong (deepseek/deepseek-reasoner): unsupported-effort')
  })

  it('checks availability before the allowlist and the allowlist before effort', () => {
    const unavailable = resolve({
      agent: agent({ modelOrder: ['strong'], reasoningEffort: 'high' }),
      snapshot: snapshot({ models: [model('strong', { provider: 'deepseek', model: 'deepseek-reasoner', available: false })], aliases: [{ alias: 'strong', targets: ['strong'] }] }),
      policy: { routes: [] },
      supportedEfforts: supports(['deepseek', 'deepseek-reasoner', []]),
    })
    const disallowed = resolve({
      agent: agent({ modelOrder: ['strong'], reasoningEffort: 'high' }),
      snapshot: entries,
      policy: { routes: [] },
      supportedEfforts: supports(['deepseek', 'deepseek-reasoner', []]),
    })

    expect(unavailable.report.candidates[0]?.skipped).toBe('unavailable')
    expect(disallowed.report.candidates[0]?.skipped).toBe('not-allowed')
  })
})

describe('convergence of the two chains (residual K)', () => {
  it('resolves alias and raw candidates through the same pipeline, differing only in origin', () => {
    const policy: ModelSelectionPolicy = { routes: [{ provider: 'deepseek', model: 'deepseek-fast' }] }
    const viaAlias = success({ agent: agent({ modelOrder: ['fast'] }), snapshot: baseSnapshot, policy })
    const viaRaw = success({ agent: agent({ model: [{ provider: 'deepseek', model: 'deepseek-fast' }] }), snapshot: baseSnapshot, policy })

    // The same route, the same payload — except for the provenance the report carries.
    expect({ provider: viaRaw.provider, model: viaRaw.model }).toEqual({ provider: viaAlias.provider, model: viaAlias.model })
    expect(viaAlias.report.candidates[0]?.origin).toBe('alias')
    expect(viaRaw.report.candidates[0]?.origin).toBe('raw')
    expect(viaAlias.report.aliasChain).toHaveLength(1)
    expect(viaRaw.report.aliasChain).toHaveLength(0)
  })

  it('accepts an AgentChainInput-shaped document without touching it', () => {
    const chain: AgentChainInput = { agentName: 'reviewer', modelOrder: ['chat'], model: [{ provider: 'local', model: 'llama' }] }

    const result = success({
      agent: { ...chain, body: '' },
      snapshot: baseSnapshot,
    })

    expect(chain).toEqual({ agentName: 'reviewer', modelOrder: ['chat'], model: [{ provider: 'local', model: 'llama' }] })
    expect(result.model).toBe('deepseek-chat')
  })
})
