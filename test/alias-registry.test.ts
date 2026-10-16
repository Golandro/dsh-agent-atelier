import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAliasRegistryService, inspectAliasRegistry, type AliasRegistryDependencies } from '../src/alias-registry.ts'
import { createNodeFileSystem } from '../src/file-system.ts'
import { DEFAULT_ALIAS_NAME } from '../src/registry-file.ts'
import type { AgentModelTarget, AliasDefinition, AliasRegistrySnapshot, ModelDefinition } from '../src/types.ts'

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
  const root = scratchDir('agents-manager-home-')
  if (layer !== undefined) writeLayer(join(root, 'agents', 'registry.yaml'), layer)
  return root
}

/** A throwaway workspace with a `.git` marker and an optional project layer. */
function workspaceDir(layer?: string): string {
  const root = scratchDir('agents-manager-ws-')
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
function service(home: string, dependencies: AliasRegistryDependencies = {}) {
  return createAliasRegistryService(dependencies, { dshHome: home })
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
