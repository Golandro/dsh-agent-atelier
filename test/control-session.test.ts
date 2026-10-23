import { describe, expect, it } from 'vitest'

import { projectItemEffort, routeNotAllowed } from '../src/control/resolve.ts'
import { ChainExhaustedError } from '../src/control/session-agent.ts'
import { createInMemoryControlCore } from '../src/control/memory.ts'
import { resolveModelChain } from '../src/core/index.ts'

import type { AgentDefinition, AliasRegistrySnapshot, ChainResolutionInput, ModelSelectionPolicy } from '../src/contract/index.ts'
import type { InMemoryControlCore } from '../src/control/memory.ts'
import type { ComposeSessionOptions } from '../src/control/session.ts'

const PROJECT = '/start-proj'
const HOME = '/start-home'
const AGENTS = `${PROJECT}/.dsh/agents`
const REGISTRY = `${AGENTS}/registry.yaml`

/**
 * Two aliases on two real routes, one entry with an `effort` column (the R1
 * `models:` column) and one registry-disabled entry, plus documents for the
 * raw escape hatch and for a document with no chain at all — the four
 * acceptance paths' fixtures.
 */
const REGISTRY_TEXT = [
  'models:',
  '  ds-chat:',
  '    provider: deepseek',
  '    model: deepseek-chat',
  '    effort: low',
  '  ds-reasoner:',
  '    provider: deepseek',
  '    model: deepseek-reasoner',
  '  off:',
  '    provider: vendor',
  '    model: retired',
  '    available: false',
  'aliases:',
  '  chat: [ds-chat]',
  '  smart: [ds-reasoner]',
  '  off: [off]',
  '',
].join('\n')

function doc(agentName: string, frontmatter: string, body: string): string {
  return `---\nname: ${agentName}\n${frontmatter}---\n${body}\n`
}

const DOCS: Readonly<Record<string, string>> = {
  // Alias chain; the effort is the entry's own column.
  'alias-agent': doc('alias-agent', 'modelOrder: [chat]\nrequiredTools: [read]\nspawn: fork\n', 'You review code.'),
  // The same chain plus the agent-level default the column covers (D7).
  'default-agent': doc('default-agent', 'modelOrder: [chat]\nreasoningEffort: low\n', 'Defaulted.'),
  // Raw escape hatch only: no alias declared (the frontmatter reader's flow form).
  'raw-agent': doc('raw-agent', 'model: [{ provider: local, model: llama }]\n', 'Local only.'),
  // Neither chain: the engine's own exhausted-chain message.
  'bare-agent': 'plain body with no chain\n',
  // A registry-disabled entry, for the not-the-policy refusal.
  'off-agent': doc('off-agent', 'modelOrder: [off]\n', 'Off.'),
}

/** One in-memory core over the fixture, with an optional host allowlist. */
function createCore(options: { readonly selectionPolicy?: ModelSelectionPolicy | undefined } = {}): InMemoryControlCore {
  const files: Record<string, string> = { [`${PROJECT}/.git`]: '', [REGISTRY]: REGISTRY_TEXT }
  for (const [agentName, text] of Object.entries(DOCS)) files[`${AGENTS}/${agentName}/${agentName}.agent.md`] = text
  return createInMemoryControlCore({
    projectRoot: PROJECT,
    dshHome: HOME,
    files,
    ...options.selectionPolicy === undefined ? {} : { selectionPolicy: options.selectionPolicy },
  })
}

/** The definition the core's registry holds, for independent expectations. */
async function definitionOf(core: InMemoryControlCore, agentName: string): Promise<AgentDefinition> {
  const snapshot = await core.snapshot({ cwd: PROJECT })
  const definition = snapshot.agents.find((agent) => agent.agentName === agentName)
  if (definition === undefined) throw new Error(`fixture is missing ${agentName}`)
  return definition
}

/** The registry half a caller reads: exactly what the engine consumes. */
async function snapshotOf(core: InMemoryControlCore): Promise<AliasRegistrySnapshot> {
  const snapshot = await core.snapshot({ cwd: PROJECT })
  return { models: snapshot.models, aliases: snapshot.aliases }
}

/** What the frozen engine answers for the same document/snapshot/inputs. */
function engineAnswer(document: AgentDefinition, snapshot: AliasRegistrySnapshot, options: ComposeSessionOptions) {
  const agent: ChainResolutionInput = {
    agentName: document.agentName,
    modelOrder: document.modelOrder,
    model: document.model,
    reasoningEffort: document.reasoningEffort,
    body: document.body,
    requiredTools: document.requiredTools,
    spawn: document.spawn,
  }
  return resolveModelChain({
    agent,
    snapshot,
    policy: options.policy,
    flavor: options.flavor,
    itemEffort: projectItemEffort(snapshot, options.itemEffort),
  })
}

describe('projectItemEffort', () => {
  const snapshot: AliasRegistrySnapshot = {
    models: [
      { modelName: 'with', provider: 'p', model: 'm1', available: true, source: 'user-dsh', effort: 'high' },
      { modelName: 'without', provider: 'p', model: 'm2', available: true, source: 'user-dsh' },
    ],
    aliases: [],
  }

  it('projects only declared efforts: a missing column never invents a row', () => {
    expect(projectItemEffort(snapshot)).toEqual({ with: 'high' })
  })

  it('lets a caller override replace one entry without dropping the others', () => {
    expect(projectItemEffort(snapshot, { with: 'low', other: 'max' })).toEqual({ with: 'low', other: 'max' })
  })
})

describe('composeSession: route resolution through the control core', () => {
  it('resolves without a policy, taking the entry effort and the document channels', async () => {
    const core = createCore()
    const result = await core.composeSession('alias-agent', { cwd: PROJECT })

    expect(result.ok).toBe(true)
    expect(result.cwd).toBe(PROJECT)
    expect(result.agent.agentName).toBe('alias-agent')
    expect(result.parameters).toEqual({
      route: { provider: 'deepseek', model: 'deepseek-chat' },
      // D7: the `models:` entry's own column, never the agent default (absent here).
      reasoningEffort: 'low',
      persona: 'You review code.',
      toolFilter: ['read'],
      flavor: 'fork',
      effortSource: 'chain',
    })
  })

  it('composes the report the engine produced for the same inputs, field for field', async () => {
    const core = createCore()
    const answer = await core.composeSession('alias-agent', { cwd: PROJECT })
    const engine = engineAnswer(await definitionOf(core, 'alias-agent'), await snapshotOf(core), {})
    if (!engine.ok) throw new Error('fixture should resolve')

    expect(answer.report).toEqual(engine.report)
    expect(answer.parameters.route).toEqual({ provider: engine.provider, model: engine.model })
    expect(answer.parameters.reasoningEffort).toBe(engine.reasoningEffort)
    expect(answer.parameters.persona).toBe(engine.persona)
    expect(answer.parameters.toolFilter).toEqual(engine.toolFilter)
    expect(answer.parameters.flavor).toBe(engine.flavor)
    expect(answer.parameters.effortSource).toBe(engine.report.effortSource)
  })

  it('lets a caller override the projected effort, and the override wins (D7)', async () => {
    const core = createCore()
    const overridden = await core.composeSession('alias-agent', { cwd: PROJECT, itemEffort: { 'ds-chat': 'high' } })
    const dropped = await core.composeSession('alias-agent', { cwd: PROJECT, itemEffort: { 'ds-chat': undefined } })

    expect(overridden.parameters.reasoningEffort).toBe('high')
    expect(overridden.parameters.effortSource).toBe('chain')
    // An explicit `undefined` drops the column back to "nothing declared".
    expect('reasoningEffort' in dropped.parameters).toBe(false)
    expect(dropped.parameters.effortSource).toBe('none')
  })

  it('falls back to the agent default when the entry declares none', async () => {
    const core = createCore()
    const result = await core.composeSession('default-agent', { cwd: PROJECT, itemEffort: { 'ds-chat': undefined } })
    expect(result.parameters.reasoningEffort).toBe('low')
    expect(result.parameters.effortSource).toBe('agent')
  })

  it('applies the flavor override from the call site over the document (D13)', async () => {
    const core = createCore()
    expect((await core.composeSession('alias-agent', { cwd: PROJECT, flavor: 'spawn' })).parameters.flavor).toBe('spawn')
    expect((await core.composeSession('alias-agent', { cwd: PROJECT })).parameters.flavor).toBe('fork')
  })

  it('leaves the existing compose path as it was', async () => {
    const core = createCore()
    const composed = await core.compose('alias-agent', { cwd: PROJECT })
    const session = await core.composeSession('alias-agent', { cwd: PROJECT })
    expect(session.agent.agentName).toBe(composed.agentName)
    expect(composed.baseText).toBe(DOCS['alias-agent'])
    await expect(core.compose('ghost', { cwd: PROJECT })).rejects.toThrow('unknown agent')
    await expect(core.composeSession('ghost', { cwd: PROJECT })).rejects.toThrow('unknown agent')
  })
})

describe('composeSession: host allowlist', () => {
  it('applies the injected policy: a refused alias exhausts the chain instead of resolving', async () => {
    const allowed = await createCore().composeSession('alias-agent', { cwd: PROJECT })
    const core = createCore({ selectionPolicy: { routes: [{ provider: 'deepseek', model: 'deepseek-reasoner' }] } })

    expect(allowed.parameters.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    await expect(core.composeSession('alias-agent', { cwd: PROJECT })).rejects.toBeInstanceOf(ChainExhaustedError)
    await expect(core.composeSession('alias-agent', { cwd: PROJECT })).rejects.toMatchObject({
      code: 'chain-exhausted',
      notAllowed: true,
    })
  })

  it('keeps walking the declaration order when a pool holds an allowed sibling', async () => {
    // One alias with a two-target pool: the first target is refused, the second wins.
    const pooled = createInMemoryControlCore({
      projectRoot: PROJECT,
      dshHome: HOME,
      files: {
        [`${PROJECT}/.git`]: '',
        [REGISTRY]: REGISTRY_TEXT.replace('  chat: [ds-chat]\n', '  chat: [ds-chat, ds-reasoner]\n'),
        [`${AGENTS}/alias-agent/alias-agent.agent.md`]: DOCS['alias-agent'] ?? '',
      },
      selectionPolicy: { routes: [{ provider: 'deepseek', model: 'deepseek-reasoner' }] },
    })
    const answer = await pooled.composeSession('alias-agent', { cwd: PROJECT })
    expect(answer.parameters.route).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner' })
    expect(answer.report.candidates.map((candidate) => [candidate.modelName, candidate.skipped])).toEqual([
      ['ds-chat', 'not-allowed'],
      ['ds-reasoner', undefined],
    ])
    // Pool order is declaration order only: no global re-sort across aliases.
    expect(answer.report.candidates.map((candidate) => candidate.orderIndex)).toEqual([0, 0])
    expect(answer.report.aliasChain).toEqual([{ orderIndex: 0, alias: 'chat', targets: ['ds-chat', 'ds-reasoner'], modelName: 'ds-reasoner' }])
  })

  it('a per-call policy wins over the injected one', async () => {
    const core = createCore({ selectionPolicy: { routes: [] } })
    await expect(core.composeSession('alias-agent', { cwd: PROJECT })).rejects.toMatchObject({ notAllowed: true })
    const allowed = await core.composeSession('alias-agent', {
      cwd: PROJECT,
      policy: { routes: [{ provider: 'deepseek', model: 'deepseek-chat' }] },
    })
    expect(allowed.parameters.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('an injected empty route list refuses every route (DSH semantics)', async () => {
    const core = createCore({ selectionPolicy: { routes: [] } })
    await expect(core.composeSession('alias-agent', { cwd: PROJECT })).rejects.toMatchObject({ notAllowed: true })
  })
})

describe('composeSession: raw fallback', () => {
  it('resolves the raw model: chain for an agent with no alias through the same pipeline', async () => {
    const core = createCore({ selectionPolicy: { routes: [{ provider: 'local', model: 'llama' }] } })
    const answer = await core.composeSession('raw-agent', { cwd: PROJECT })

    expect(answer.parameters.route).toEqual({ provider: 'local', model: 'llama' })
    expect(answer.parameters.persona).toBe('Local only.')
    expect(answer.parameters.effortSource).toBe('none')
    expect(answer.report.selectedBy).toBe('raw')
    expect(answer.report.rawFallbackUsed).toBe(true)
    expect(answer.report.candidates).toEqual([{ route: { provider: 'local', model: 'llama' }, origin: 'raw' }])
  })

  it('refuses a raw route outside the policy exactly as the alias half does', async () => {
    const core = createCore({ selectionPolicy: { routes: [{ provider: 'deepseek', model: 'deepseek-chat' }] } })
    await expect(core.composeSession('raw-agent', { cwd: PROJECT })).rejects.toMatchObject({
      code: 'chain-exhausted',
      notAllowed: true,
    })
  })
})

describe('composeSession: chain exhausted is a hard error, unrewritten', () => {
  it('re-throws the engine failure with its exact message and report', async () => {
    const policy: ModelSelectionPolicy = { routes: [] }
    const core = createCore()
    const engine = engineAnswer(await definitionOf(core, 'alias-agent'), await snapshotOf(core), { policy })
    if (engine.ok) throw new Error('fixture should exhaust')

    let caught: unknown
    try {
      await core.composeSession('alias-agent', { cwd: PROJECT, policy })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ChainExhaustedError)
    const error = caught as ChainExhaustedError
    expect(error.name).toBe('ChainExhaustedError')
    expect(error.code).toBe('chain-exhausted')
    expect(error.message).toBe(engine.message)
    expect(error.message).toContain('the chain was exhausted')
    expect(error.report).toEqual(engine.report)
    expect(error.notAllowed).toBe(true)
  })

  it('reports a document with no chain at all through the engine, not a second path', async () => {
    const core = createCore()
    await expect(core.composeSession('bare-agent', { cwd: PROJECT })).rejects.toMatchObject({
      code: 'chain-exhausted',
      notAllowed: false,
      message: expect.stringContaining('neither modelOrder aliases nor model entries are declared'),
    })
  })

  it('does not blame the policy for a registry-disabled route', async () => {
    const core = createCore()
    await expect(core.composeSession('off-agent', { cwd: PROJECT })).rejects.toMatchObject({
      code: 'chain-exhausted',
      notAllowed: false,
      message: expect.stringContaining('off (vendor/retired): unavailable'),
    })
  })
})

describe('routeNotAllowed', () => {
  const snapshot: AliasRegistrySnapshot = {
    models: [{ modelName: 'm', provider: 'p', model: 'm', available: true, source: 'user-dsh' }],
    aliases: [{ alias: 'a', targets: ['m'], source: 'user-dsh' }],
  }

  it('names the policy refusal on the report it is given', () => {
    const refused = resolveModelChain({ agent: { agentName: 'x', body: '', modelOrder: ['a'] }, snapshot, policy: { routes: [] } })
    const allowed = resolveModelChain({ agent: { agentName: 'x', body: '', modelOrder: ['a'] }, snapshot })
    expect(routeNotAllowed(refused, { provider: 'p', model: 'm' })).toBe(true)
    expect(routeNotAllowed(allowed, { provider: 'p', model: 'm' })).toBe(false)
  })
})
