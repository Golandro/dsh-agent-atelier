/**
 * Ticket 07b / #56: chain resolution actually consumes the recorder's reading.
 *
 * One snapshot, one agent, one pool: with no ledger the first declared model
 * wins; once the ledger reaches the R2 threshold the same snapshot resolves to
 * the sibling instead. This is the "same report changes with observations"
 * lock the ticket asks for — the engine side was already covered by
 * `test/resolve-model-chain.test.ts`; here the session path is fed by the
 * ledger the recorder produces.
 */
import { describe, expect, it } from 'vitest'

import { createInMemoryControlCore } from '../src/control/memory.ts'
import { RATE_LIMIT_WINDOW_MS } from '../src/resolve/observations.ts'

import type { ChainObservations } from '../src/contract/index.ts'

const PROJECT = '/ledger-proj'
const HOME = '/ledger-home'
const AGENTS = `${PROJECT}/.dsh/agents`
const REGISTRY = `${AGENTS}/registry.yaml`
const NOW = 1_000_000

// One alias pool with two models, declared in order: "first" must win until
// the ledger demotes it behind its active sibling.
const REGISTRY_TEXT = [
  'models:',
  '  first:',
  '    provider: deepseek',
  '    model: deepseek-chat',
  '  second:',
  '    provider: vendor',
  '    model: vendor-chat',
  'aliases:',
  '  pool: [first, second]',
  '',
].join('\n')

const DOC = '---\nname: pooled\nmodelOrder: [pool]\n---\nPooled body.\n'

function core() {
  return createInMemoryControlCore({
    projectRoot: PROJECT,
    dshHome: HOME,
    files: {
      [`${PROJECT}/.git`]: '',
      [REGISTRY]: REGISTRY_TEXT,
      [`${AGENTS}/pooled/pooled.agent.md`]: DOC,
    },
  })
}

function ledger(...routes: ChainObservations['routes']): ChainObservations {
  return { routes }
}

const FIRST = { provider: 'deepseek', model: 'deepseek-chat' } as const

describe('composeSession consumes the failure ledger (R2 §2.2/§2.4)', () => {
  it('picks the first declared route when there is no ledger', async () => {
    const session = await core().composeSession('pooled', { cwd: PROJECT })

    expect(session.parameters.route).toEqual(FIRST)
    // No ledger ⇒ no health field: the report keeps its pre-R2 shape.
    expect(session.report.candidates.every((candidate) => candidate.health === undefined)).toBe(true)
  })

  it('does not move below the threshold, but moves at it', async () => {
    const below = await core().composeSession('pooled', {
      cwd: PROJECT,
      observations: ledger({ route: FIRST, failures: 1 }),
      now: NOW,
    })
    expect(below.parameters.route).toEqual(FIRST)

    const at = await core().composeSession('pooled', {
      cwd: PROJECT,
      observations: ledger({ route: FIRST, failures: 2 }),
      now: NOW,
    })
    expect(at.parameters.route).toEqual({ provider: 'vendor', model: 'vendor-chat' })
    expect(at.report.candidates.find((candidate) => candidate.route?.provider === 'deepseek')?.health).toBe('degraded')
  })

  it('judges a rate-limit streak by the same clock the recorder was read at', async () => {
    const streak = ledger({ route: FIRST, rateLimitStreak: 3, rateLimitSince: NOW })
    const inWindow = await core().composeSession('pooled', { cwd: PROJECT, observations: streak, now: NOW + 1_000 })
    const stale = await core().composeSession('pooled', { cwd: PROJECT, observations: streak, now: NOW + RATE_LIMIT_WINDOW_MS + 1 })

    expect(inWindow.parameters.route).toEqual({ provider: 'vendor', model: 'vendor-chat' })
    expect(stale.parameters.route).toEqual(FIRST)
  })
})
