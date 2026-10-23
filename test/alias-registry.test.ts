import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAliasRegistryService, inspectAliasRegistry, type AliasRegistryDependencies } from '../src/core/catalog/alias-registry.ts'
import { createNodeFileSystem } from '../src/providers/fs/index.ts'
import { DEFAULT_ALIAS_NAME } from '../src/core/catalog/registry-file.ts'
import type { AgentModelTarget, AliasDefinition, AliasRegistrySnapshot, ModelDefinition } from '../src/contract/types.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** A throwaway `$DSH_HOME` with an optional global registry.yaml layer. */
function homeDir(layer?: string): string {
  const root = scratchDir('agent-atelier-home-')
  if (layer !== undefined) writeLayer(join(root, 'agents', 'registry.yaml'), layer)
  return root
}

/** A throwaway workspace with a `.git` marker and an optional project layer. */
function workspaceDir(layer?: string): string {
  const root = scratchDir('agent-atelier-ws-')
  mkdirSync(join(root, '.git'), { recursive: true })
  if (layer !== undefined) writeLayer(join(root, '.dsh', 'agents', 'registry.yaml'), layer)
  return root
}

function writeLayer(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function projectLayerPath(workspace: string): string {
  return join(workspace, '.dsh', 'agents', 'registry.yaml')
}

/** A service whose global layer lives in a throwaway home, never the machine's. */
function service(home: string, dependencies: Partial<AliasRegistryDependencies> = {}) {
  return createAliasRegistryService({ nodeFileSystem: createNodeFileSystem(), ...dependencies }, { dshHome: home })
}

const USER_LAYER = `models:
  ds-chat: { provider: deepseek, model: deepseek-chat, sysPrompt: "偏对话", available: true }
  ds-reasoner:
    provider: deepseek
    model: deepseek-reasoner
    available: false
aliases:
  smart: [ds-reasoner]
  fast: [ds-chat]
`

function model(modelName: string, overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return { modelName, provider: 'deepseek', model: modelName, available: true, source: 'user-dsh', ...overrides }
}

function alias(aliasName: string, targets: readonly string[], overrides: Partial<AliasDefinition> = {}): AliasDefinition {
  return { alias: aliasName, targets, source: 'user-dsh', ...overrides }
}

describe('alias registry layers', () => {
  it('merges both layers with the workspace winning on a shared name', async () => {
    const home = homeDir(USER_LAYER)
    const workspace = workspaceDir('models:\n  ds-chat: { provider: deepseek, model: deepseek-v4 }\naliases:\n  fast: [ds-reasoner]\n')

    const snapshot = await service(home).snapshot({ cwd: workspace })

    expect(snapshot.models.map((entry) => [entry.modelName, entry.model, entry.source])).toEqual([
      ['ds-chat', 'deepseek-v4', 'project-dsh'],
      ['ds-reasoner', 'deepseek-reasoner', 'user-dsh'],
    ])
    // The workspace layer comes first, mirroring the discovery roots' rank order.
    expect(snapshot.aliases.map((entry) => [entry.alias, entry.targets[0], entry.source])).toEqual([
      ['fast', 'ds-reasoner', 'project-dsh'],
      ['smart', 'ds-reasoner', 'user-dsh'],
    ])
  })

  it('reads only the global layer when no cwd is given', async () => {
    const home = homeDir(USER_LAYER)
    const workspace = workspaceDir('models:\n  ds-chat: { provider: deepseek, model: deepseek-v4 }\naliases:\n  fast: [ds-reasoner]\n')

    const snapshot = await service(home).snapshot()

    expect(snapshot.models.map((entry) => entry.model)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(snapshot.aliases.map((entry) => entry.alias)).toEqual(['smart', 'fast'])
    await expect(service(home).snapshot({ cwd: workspace })).resolves.toBeDefined()
  })

  it('drops a broken layer with a diagnostic and still merges the other one', async () => {
    const home = homeDir(USER_LAYER)
    const workspace = workspaceDir('aliases:\n  broken: [ds-chat\n')
    const registry = service(home)

    const snapshot = await registry.snapshot({ cwd: workspace })

    expect(snapshot.models.map((entry) => entry.modelName)).toEqual(['ds-chat', 'ds-reasoner'])
    const diagnostics = await registry.diagnostics({ cwd: workspace })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: 'unparseable-registry', path: projectLayerPath(workspace) })
  })

  it('keeps only the built-in alias when both layers are broken', async () => {
    const home = homeDir('nope: 1\n')
    const workspace = workspaceDir('aliases:\n  broken: [ds-chat\n')
    const registry = service(home, { readDefaultPair: () => ({ provider: 'volcengine-plan', model: 'glm-5.3' }) })

    const snapshot = await registry.snapshot({ cwd: workspace })

    expect(snapshot.models.map((entry) => entry.modelName)).toEqual([DEFAULT_ALIAS_NAME])
    expect(snapshot.aliases.map((entry) => entry.alias)).toEqual([DEFAULT_ALIAS_NAME])
    expect((await registry.diagnostics({ cwd: workspace })).map((entry) => entry.code)).toEqual([
      'unparseable-registry',
      'invalid-registry',
    ])
  })

  it('treats a missing layer file as an empty layer, not a problem', async () => {
    const registry = service(homeDir())

    expect(await registry.snapshot()).toEqual({ models: [], aliases: [] })
    expect(await registry.diagnostics()).toEqual([])
  })

  it('serves one alias and one model by name', async () => {
    const home = homeDir(USER_LAYER)
    const registry = service(home)

    expect(await registry.getAlias('fast')).toMatchObject({ alias: 'fast', targets: ['ds-chat'], source: 'user-dsh' })
    expect(await registry.getModel('ds-reasoner')).toMatchObject({ provider: 'deepseek', available: false })
    expect(await registry.getModel('ds-chat')).toMatchObject({ path: join(home, 'agents', 'registry.yaml') })
    expect(await registry.getAlias('missing')).toBeUndefined()
    expect(await registry.getModel('missing')).toBeUndefined()
  })
})

/** Two provider lines of one model id, one of them switched off at model level. */
const POOLED_LAYER = [
  'models:',
  '  reasoner-official: { provider: deepseek-official, model: deepseek-reasoner, available: true, modelGroup: reasoner, effort: high }',
  '  reasoner-account:',
  '    provider: deepseek-account',
  '    model: deepseek-reasoner',
  '    available: false',
  '    modelGroup: reasoner',
  '    effort: medium',
  '  chat-official: { provider: deepseek-official, model: deepseek-chat }',
  'aliases:',
  '  smart: [reasoner-official, reasoner-account]',
  '  fast: [chat-official]',
].join('\n')

describe('the model-level switch (modelGroup)', () => {
  it('folds a false entry into every sibling of its group at load time', async () => {
    const registry = service(homeDir(POOLED_LAYER))

    const snapshot = await registry.snapshot()

    // One flag in one group switches the whole model off: the sibling reads
    // false although the file says nothing about it, and the line switch is
    // not duplicated in every entry (R1 §2.2).
    expect(snapshot.models.map((entry) => [entry.modelName, entry.available, entry.modelGroup, entry.effort])).toEqual([
      ['reasoner-official', false, 'reasoner', 'high'],
      ['reasoner-account', false, 'reasoner', 'medium'],
      ['chat-official', true, undefined, undefined],
    ])
    expect(snapshot.aliases.find((entry) => entry.alias === 'smart')?.targets).toEqual(['reasoner-official', 'reasoner-account'])
  })

  it('leaves a group alone while every entry of it is available', async () => {
    const layer = 'models:\n  a: { provider: p1, model: m, modelGroup: g }\n  b: { provider: p2, model: m, modelGroup: g }\n'
    const snapshot = await service(homeDir(layer)).snapshot()

    expect(snapshot.models.map((entry) => entry.available)).toEqual([true, true])
  })

  it('treats an entry without a group as a group of its own', async () => {
    // No modelGroup means the entry is its own group (R1 §2.2), so switching
    // one entry off never reaches an ungrouped sibling.
    const layer = 'models:\n  a: { provider: p1, model: m, available: false }\n  b: { provider: p2, model: m }\n'
    const snapshot = await service(homeDir(layer)).snapshot()

    expect(snapshot.models.map((entry) => [entry.modelName, entry.available])).toEqual([
      ['a', false],
      ['b', true],
    ])
  })

  it('judges the merged set, so a workspace override decides both membership and outcome', async () => {
    // The global layer switches a group off. The workspace redefines one
    // member into another group, so only the entry that stayed behind is
    // still covered by the off group — the override is judged as the
    // definition that won, not as the one it replaced.
    const home = homeDir('models:\n  reasoner-official: { provider: p, model: m, available: false, modelGroup: reasoner }\n')
    const workspace = workspaceDir('models:\n  reasoner-official: { provider: p, model: m, available: true, modelGroup: other }\n  reasoner-account: { provider: q, model: m, modelGroup: reasoner }\n')

    const snapshot = await service(home).snapshot({ cwd: workspace })

    expect(snapshot.models.map((entry) => [entry.modelName, entry.modelGroup, entry.available])).toEqual([
      ['reasoner-official', 'other', true],
      ['reasoner-account', 'reasoner', true],
    ])
  })

  it('keeps the modelGroup and effort columns the reader found on the merged entries', async () => {
    const registry = service(homeDir(POOLED_LAYER))

    expect(await registry.getModel('reasoner-account')).toMatchObject({ modelGroup: 'reasoner', effort: 'medium' })
  })
})

describe('the built-in dsh-default alias', () => {
  it('points at the declared entry whose provider and model match the default pair', async () => {
    const registry = service(homeDir(USER_LAYER), { readDefaultPair: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) })

    const snapshot = await registry.snapshot()
    const builtIn = snapshot.aliases.find((entry) => entry.alias === DEFAULT_ALIAS_NAME)

    expect(builtIn).toMatchObject({ targets: ['ds-chat'], source: 'built-in' })
    expect(builtIn?.path).toBeUndefined()
    // A match is a pure pointer: nothing is synthesised.
    expect(snapshot.models.map((entry) => entry.modelName)).toEqual(['ds-chat', 'ds-reasoner'])
  })

  it('synthesises an implicit entry when no declared entry matches the pair', async () => {
    const registry = service(homeDir(USER_LAYER), { readDefaultPair: () => ({ provider: 'volcengine-plan', model: 'glm-5.3' }) })

    const snapshot = await registry.snapshot()

    expect(snapshot.models).toContainEqual({
      modelName: DEFAULT_ALIAS_NAME,
      provider: 'volcengine-plan',
      model: 'glm-5.3',
      available: true,
      source: 'built-in',
      synthesized: true,
    })
    expect(snapshot.aliases.find((entry) => entry.alias === DEFAULT_ALIAS_NAME)?.targets).toEqual([DEFAULT_ALIAS_NAME])
  })

  it('picks the first match in merge order when several entries share the pair', async () => {
    const home = homeDir('models:\n  user-model: { provider: p, model: m }\n')
    const workspace = workspaceDir('models:\n  project-model: { provider: p, model: m }\n')
    const registry = service(home, { readDefaultPair: () => ({ provider: 'p', model: 'm' }) })

    const snapshot = await registry.snapshot({ cwd: workspace })

    expect(snapshot.aliases.find((entry) => entry.alias === DEFAULT_ALIAS_NAME)?.targets).toEqual(['project-model'])
  })

  it('follows the pair only after invalidate, because the load takes a snapshot (D24)', async () => {
    let pair: AgentModelTarget | undefined = { provider: 'p', model: 'a' }
    const home = homeDir('models:\n  model-a: { provider: p, model: a }\n  model-b: { provider: p, model: b }\n')
    const registry = service(home, { readDefaultPair: () => pair })

    const target = async (): Promise<string | undefined> =>
      (await registry.snapshot()).aliases.find((entry) => entry.alias === DEFAULT_ALIAS_NAME)?.targets[0]

    expect(await target()).toBe('model-a')
    pair = { provider: 'p', model: 'b' }
    expect(await target()).toBe('model-a')
    registry.invalidate()
    expect(await target()).toBe('model-b')
  })

  it('is absent when no default pair can be read', async () => {
    const home = homeDir(USER_LAYER)

    for (const registry of [service(home), service(home, { readDefaultPair: () => undefined })]) {
      const snapshot = await registry.snapshot()
      expect(snapshot.aliases.some((entry) => entry.alias === DEFAULT_ALIAS_NAME)).toBe(false)
      expect(snapshot.models.some((entry) => entry.synthesized === true)).toBe(false)
    }
  })

  it('does not invent a pair, and names the host as the cause when the built-in alias is missing', async () => {
    // On a host with no readable default pair the bundled default agent's chain
    // really does dangle, so the finding stays an error — but it points at the
    // host, not at a declaration the user is forbidden to write (the name is
    // reserved on both sides).
    const snapshot = await service(homeDir(USER_LAYER)).snapshot()

    const findings = inspectAliasRegistry(snapshot, [{ agentName: 'default', modelOrder: [DEFAULT_ALIAS_NAME] }])

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'error', code: 'unknown-alias', alias: DEFAULT_ALIAS_NAME })
    expect(findings[0]?.message).toContain('agentDefaultModel')
  })
})

describe('the alias registry read model', () => {
  it('loads once per project root and only reloads after invalidate', async () => {
    const home = homeDir(USER_LAYER)
    let reads = 0
    const node = createNodeFileSystem()
    const registry = service(home, {
      nodeFileSystem: node,
      resolveFileSystem: () => ({
        ...node,
        readTextFile: async (path, signal) => {
          reads += 1
          return await node.readTextFile(path, signal)
        },
      }),
    })

    await registry.snapshot()
    const afterFirst = reads
    expect(afterFirst).toBeGreaterThan(0)

    await registry.snapshot()
    await registry.diagnostics()
    await registry.getAlias('fast')
    expect(reads).toBe(afterFirst)

    registry.invalidate()
    await registry.snapshot()
    expect(reads).toBeGreaterThan(afterFirst)
  })

  it('reads through the host fs service when the context has one', async () => {
    const home = homeDir()
    const registry = service(home, {
      nodeFileSystem: createNodeFileSystem(),
      resolveFileSystem: () => ({
        listDirectory: async () => [],
        pathExists: async () => true,
        readTextFile: async (path) => path.endsWith('registry.yaml') ? 'aliases:\n  from-host: [host-model]\n' : undefined,
      }),
    })

    const snapshot = await registry.snapshot()

    expect(snapshot.aliases).toEqual([{ alias: 'from-host', targets: ['host-model'], source: 'user-dsh', path: join(home, 'agents', 'registry.yaml') }])
  })
})

describe('cross-layer inspection (pure, ticket 03 consumes it)', () => {
  const clean: AliasRegistrySnapshot = { models: [model('ds-chat')], aliases: [alias('fast', ['ds-chat'])] }

  it('reports nothing for a registry whose aliases and agent chains all resolve', () => {
    expect(inspectAliasRegistry(clean, [{ agentName: 'plan', modelOrder: ['fast'] }])).toEqual([])
    expect(inspectAliasRegistry(clean)).toEqual([])
  })

  it('reports an agent alias the registry does not have as an error', () => {
    expect(inspectAliasRegistry(clean, [{ agentName: 'plan', modelOrder: ['ghost'] }])).toEqual([
      {
        severity: 'error',
        code: 'unknown-alias',
        agentName: 'plan',
        alias: 'ghost',
        message: 'agent "plan" modelOrder names alias "ghost", which the registry does not have',
      },
    ])
  })

  it('reports an alias pointing at an undeclared model as an error', () => {
    const findings = inspectAliasRegistry({ models: [model('ds-chat')], aliases: [alias('fast', ['ghost'])] })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'error', code: 'unknown-model-target', alias: 'fast' })
  })

  it('hints when several aliases point at one model, but not for the built-in pointer', () => {
    const fanIn = inspectAliasRegistry({ models: [model('ds-chat')], aliases: [alias('fast', ['ds-chat']), alias('quick', ['ds-chat'])] })
    expect(fanIn).toHaveLength(1)
    expect(fanIn[0]).toMatchObject({ severity: 'hint', code: 'alias-fan-in' })

    const withBuiltIn = inspectAliasRegistry({
      models: [model('ds-chat')],
      aliases: [alias('fast', ['ds-chat']), alias(DEFAULT_ALIAS_NAME, ['ds-chat'], { source: 'built-in' })],
    })
    expect(withBuiltIn).toEqual([])
  })

  it('judges fan-in per route, so two lines of one model are not a shared capability', () => {
    // R1 D-8: an alias pool of one model behind two providers is redundancy,
    // not two aliases fighting over the same capability.
    const snapshot: AliasRegistrySnapshot = {
      models: [
        model('reasoner-official', { provider: 'deepseek-official', model: 'deepseek-reasoner', modelGroup: 'reasoner' }),
        model('reasoner-account', { provider: 'deepseek-account', model: 'deepseek-reasoner', modelGroup: 'reasoner' }),
      ],
      aliases: [alias('smart', ['reasoner-official', 'reasoner-account'])],
    }

    // Same model, same group, other lines: nothing to report at all.
    expect(inspectAliasRegistry(snapshot)).toEqual([])

    // Two aliases spending the same line is the intent overlap fan-in is for,
    // and the message names the route rather than one entry name. (Two lines
    // of one model are distinct routes, so they do not fan in at all.)
    const shared = inspectAliasRegistry({
      models: snapshot.models,
      aliases: [alias('smart', ['reasoner-official']), alias('deep', ['reasoner-official'])],
    })
    expect(shared).toHaveLength(1)
    expect(shared[0]).toMatchObject({ severity: 'hint', code: 'alias-fan-in', alias: 'smart, deep' })
    expect(shared[0]?.message).toContain('deepseek-official/deepseek-reasoner')

    // The equivalent-line case (R1-F) is not a second finding: one alias, one
    // pool, however many entry names it spends on that route.
    const redundant = inspectAliasRegistry({
      models: [
        model('line-a', { provider: 'deepseek', model: 'deepseek-chat', modelGroup: 'chat' }),
        model('line-b', { provider: 'deepseek', model: 'deepseek-chat', modelGroup: 'chat' }),
      ],
      aliases: [alias('chat', ['line-a', 'line-b'])],
    })
    // Nothing at all — not even the group hint, since both lines share a group.
    expect(redundant).toEqual([])
  })

  it('hints when a pool mixes models, pointing the gradient at modelOrder', () => {
    // R1 §7.4: legal syntax, but the gradient silently changes capability tier,
    // sysPrompt and effort support once a line is skipped.
    const findings = inspectAliasRegistry({
      models: [
        model('ds-reasoner', { model: 'deepseek-reasoner', modelGroup: 'reasoner' }),
        model('ds-chat', { model: 'deepseek-chat', modelGroup: 'reasoner' }),
      ],
      aliases: [alias('smart', ['ds-reasoner', 'ds-chat'])],
    })

    // One group, so this is purely the capability-gradient complaint.
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'hint', code: 'pool-mixed-models', alias: 'smart' })
    expect(findings[0]?.message).toContain('modelOrder')
    expect(findings[0]?.message).toContain('ds-chat')

    // One model, two lines of one group: no hint. A pool of one cannot mix
    // anything either.
    expect(inspectAliasRegistry({
      models: [
        model('a', { provider: 'p1', model: 'm', modelGroup: 'm' }),
        model('b', { provider: 'p2', model: 'm', modelGroup: 'm' }),
      ],
      aliases: [alias('pooled', ['a', 'b'])],
    })).toEqual([])
  })

  it('hints when a pool mixes modelGroups, which the model-level switch cannot cover', () => {
    // modelGroup is optional, so an entry without one is its own group (R1 §2.2).
    const findings = inspectAliasRegistry({
      models: [
        model('line-a', { model: 'm', modelGroup: 'group-m' }),
        model('line-b', { model: 'm' }),
      ],
      aliases: [alias('pooled', ['line-a', 'line-b'])],
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'hint', code: 'pool-mixed-groups', alias: 'pooled' })
    expect(findings[0]?.message).toContain('group-m')
    expect(findings[0]?.message).toContain('line-b')

    // One group spelled explicitly or by default: nothing to report.
    expect(inspectAliasRegistry({
      models: [
        model('line-a', { model: 'm', modelGroup: 'group-m' }),
        model('line-b', { model: 'm', modelGroup: 'group-m' }),
      ],
      aliases: [alias('pooled', ['line-a', 'line-b'])],
    })).toEqual([])
  })

  it('reports both pool hints for a pool that mixes models and groups at once', () => {
    const findings = inspectAliasRegistry({
      models: [model('a', { model: 'm-a' }), model('b', { model: 'm-b', modelGroup: 'b' })],
      aliases: [alias('pooled', ['a', 'b'])],
    })

    expect(findings.map((finding) => finding.code)).toEqual(['pool-mixed-models', 'pool-mixed-groups'])
  })

  it('judges only the targets the registry has, leaving unknown ones to their error', () => {
    const findings = inspectAliasRegistry({
      models: [model('ds-reasoner')],
      aliases: [alias('smart', ['ds-reasoner', 'ghost'])],
    })

    expect(findings.map((finding) => finding.code)).toEqual(['unknown-model-target'])
  })

  it('hints when an agent still uses the raw model escape hatch (D5)', () => {
    const findings = inspectAliasRegistry(clean, [{ agentName: 'plan', model: [{ provider: 'deepseek', model: 'deepseek-chat' }] }])

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'hint', code: 'raw-model-escape', agentName: 'plan' })
  })

  it('is deterministic for the same inputs', () => {
    const snapshot: AliasRegistrySnapshot = {
      models: [model('ds-chat')],
      aliases: [alias('fast', ['ds-chat']), alias('quick', ['ds-chat']), alias('ghost', ['nowhere'])],
    }
    const agents = [{ agentName: 'plan', modelOrder: ['fast', 'nope'], model: [{ provider: 'p', model: 'm' }] }]

    expect(inspectAliasRegistry(snapshot, agents)).toEqual(inspectAliasRegistry(snapshot, agents))
    expect(inspectAliasRegistry(snapshot, agents).length).toBeGreaterThan(0)
  })
})
