import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AgentDocumentError,
  createAgentRegistryService,
} from '../src/core/catalog/discovery.ts'
import { findProjectRoot, resolveAgentsHome, resolveDshHome } from '../src/core/catalog/roots.ts'
import { createAgentProviders } from '../src/core/providers-registry.ts'
import type { AgentFileSystem } from '../src/core/ports.ts'
import { createFileSystemAgentProvider, createNodeFileSystem } from '../src/providers/fs/index.ts'
import {
  BUNDLED_AGENT_RANK,
  PROJECT_AGENTS_RANK,
  PROJECT_DSH_RANK,
  USER_AGENTS_RANK,
  USER_DSH_RANK,
} from '../src/dsh/host/providers.ts'
import type { AgentDefinition, AgentDiagnostic, AgentOrigin, AgentSource } from '../src/contract/types.ts'
import type { ProviderControl } from '../src/contract/index.ts'

let tmp = ''

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-atelier-discovery-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** One agent document: fenced frontmatter plus body, or a bare body. */
function document(frontmatter: string | undefined, body = 'body text'): string {
  return frontmatter === undefined ? body : `---\n${frontmatter}\n---\n${body}`
}

/** A fake project root: the `.git` marker stops `findProjectRoot`. */
function makeProjectRoot(): string {
  const root = join(tmp, 'project')
  mkdirSync(join(root, '.git'), { recursive: true })
  return root
}

function writeAgent(root: string, name: string, frontmatter: string | undefined = 'modelOrder: [fast]', body = 'body text'): string {
  const path = join(root, name, `${name}.agent.md`)
  write(path, document(frontmatter, body))
  return path
}

interface Harness {
  readonly registry: ReturnType<typeof createAgentRegistryService>
  readonly providers: ReturnType<typeof createAgentProviders>
  readonly project: string
  readonly dshHome: string
  readonly agentsHome: string
  readonly bundled: string
  readonly warnings: string[]
  readonly disposers: Record<string, () => void>
  readonly registerRoot: (id: string, source: AgentSource, rank: number, trust: 'trusted' | 'untrusted', origin: AgentOrigin, resolveRoot: (projectRoot: string | undefined) => string | undefined, selectFileSystem?: () => AgentFileSystem) => () => void
}

/** A registry whose every root is a throwaway directory under `tmp`, served by real fs providers. */
function harness(resolveFileSystem?: () => AgentFileSystem | undefined): Harness {
  const project = makeProjectRoot()
  const dshHome = join(tmp, 'home-dsh')
  const agentsHome = join(tmp, 'home-agents')
  const bundled = join(tmp, 'bundled')
  const warnings: string[] = []
  const providers = createAgentProviders()
  const nodeFileSystem = createNodeFileSystem()
  const selectQueryable = () => resolveFileSystem?.() ?? nodeFileSystem

  function registerRoot(
    id: string,
    source: AgentSource,
    rank: number,
    trust: 'trusted' | 'untrusted',
    origin: AgentOrigin,
    resolveRoot: (projectRoot: string | undefined) => string | undefined,
    selectFileSystem: () => AgentFileSystem = selectQueryable,
  ): () => void {
    return providers.registerAgentProvider(() =>
      createFileSystemAgentProvider({ id, source, rank, trust, origin, resolveRoot, selectFileSystem }),
    )
  }

  const disposers: Record<string, () => void> = {
    'project-dsh': registerRoot('project-dsh', 'project-dsh', PROJECT_DSH_RANK, 'untrusted', 'user', (root) => (root === undefined ? undefined : join(root, '.dsh', 'agents'))),
    'project-agents': registerRoot('project-agents', 'project-agents', PROJECT_AGENTS_RANK, 'untrusted', 'user', (root) => (root === undefined ? undefined : join(root, '.agents', 'agents'))),
    'user-dsh': registerRoot('user-dsh', 'user-dsh', USER_DSH_RANK, 'untrusted', 'user', () => join(dshHome, 'agents')),
    'user-agents': registerRoot('user-agents', 'user-agents', USER_AGENTS_RANK, 'untrusted', 'user', () => join(agentsHome, 'agents')),
    bundled: registerRoot('bundled', 'bundled', BUNDLED_AGENT_RANK, 'trusted', 'built-in', () => bundled, () => nodeFileSystem),
  }

  const registry = createAgentRegistryService({
    providers,
    nodeFileSystem,
    warn: (message) => warnings.push(message),
    ...(resolveFileSystem !== undefined ? { resolveFileSystem } : {}),
  })
  return { registry, providers, project, dshHome, agentsHome, bundled, warnings, disposers, registerRoot }
}

/** Wrap a filesystem port and count directory listings. */
function countingFileSystem(inner: AgentFileSystem): { fileSystem: AgentFileSystem; listCalls: () => number } {
  let calls = 0
  return {
    fileSystem: {
      listDirectory: (path, signal) => {
        calls += 1
        return inner.listDirectory(path, signal)
      },
      readTextFile: (path, signal) => inner.readTextFile(path, signal),
      pathExists: (path, signal) => inner.pathExists(path, signal),
    },
    listCalls: () => calls,
  }
}

function codes(diagnostics: readonly AgentDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

describe('agent discovery roots', () => {
  it('finds agents in all four roots plus the bundled root, lowest rank first', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')
    writeAgent(join(test.project, '.agents', 'agents'), 'beta')
    writeAgent(join(test.dshHome, 'agents'), 'gamma')
    writeAgent(join(test.agentsHome, 'agents'), 'delta')
    writeAgent(test.bundled, 'epsilon')

    const list = await test.registry.list({ cwd: join(test.project, 'nested', 'deeper') })

    expect(list.map((definition) => [definition.agentName, definition.source, definition.origin])).toEqual([
      ['alpha', 'project-dsh', 'user'],
      ['beta', 'project-agents', 'user'],
      ['gamma', 'user-dsh', 'user'],
      ['delta', 'user-agents', 'user'],
      ['epsilon', 'bundled', 'built-in'],
    ])
    expect(list.map((definition) => definition.providerId)).toEqual([
      'project-dsh',
      'project-agents',
      'user-dsh',
      'user-agents',
      'bundled',
    ])
  })

  it('lets the workspace win a duplicate agent name, then the earlier user root', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'shared', 'modelOrder: [fast]', 'project body')
    writeAgent(join(test.dshHome, 'agents'), 'shared', 'modelOrder: [fast]', 'user body')
    writeAgent(test.bundled, 'shared')
    writeAgent(join(test.project, '.agents', 'agents'), 'second')
    writeAgent(join(test.dshHome, 'agents'), 'second')

    const list = await test.registry.list({ cwd: test.project })

    expect(list.map((definition) => [definition.agentName, definition.source])).toEqual([
      ['shared', 'project-dsh'],
      ['second', 'project-agents'],
    ])
    expect(list.find((definition) => definition.agentName === 'shared')?.body).toBe('project body')
  })

  it('skips the project roots when no cwd is given', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')
    writeAgent(join(test.dshHome, 'agents'), 'gamma')

    const list = await test.registry.list()

    expect(list.map((definition) => definition.agentName)).toEqual(['gamma'])
  })

  it('serves one agent by agent name and returns undefined for an unknown one', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')

    await expect(test.registry.get('alpha', { cwd: test.project })).resolves.toMatchObject({ agentName: 'alpha' })
    await expect(test.registry.get('missing', { cwd: test.project })).resolves.toBeUndefined()
  })
})

describe('agent document layout', () => {
  it('reports every layout violation and keeps only the valid agent', async () => {
    const test = harness()
    const root = join(test.project, '.dsh', 'agents')
    const validPath = writeAgent(root, 'unexpected-id-agent', 'id: legacy-id\nmodelOrder: [fast]')
    write(join(root, 'ghost', 'other.md'), 'stray\n')
    write(join(root, 'Bad_Name', 'Bad_Name.agent.md'), document('modelOrder: [fast]'))
    write(join(root, '.hidden', '.hidden.agent.md'), document('modelOrder: [fast]'))
    write(join(root, 'flat.md'), document('modelOrder: [fast]'))
    write(join(root, 'also-flat.agent.md'), document('modelOrder: [fast]'))
    write(join(root, 'README.md'), 'not an agent\n')
    write(join(root, 'registry.yaml'), 'models: {}\n')
    const strayAgent = writeAgent(root, 'tidy', 'modelOrder: [fast]')
    write(join(dirname(strayAgent), 'notes.md'), 'ignored extension slot\n')

    const list = await test.registry.list({ cwd: test.project })
    const diagnostics = await test.registry.diagnostics({ cwd: test.project })

    expect(list.map((definition) => definition.agentName)).toEqual(['tidy', 'unexpected-id-agent'])
    expect(codes(diagnostics).sort()).toEqual([
      'invalid-agent-name',
      'misplaced-file',
      'misplaced-file',
      'missing-document',
      'unexpected-id',
    ])
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.providerId))).toEqual(new Set(['project-dsh']))
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'invalid-agent-name')?.path).toBe(join(root, 'Bad_Name'))
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'unexpected-id')?.path).toBe(validPath)
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'misplaced-file').map((diagnostic) => diagnostic.path).sort())
      .toEqual([join(root, 'also-flat.agent.md'), join(root, 'flat.md')].sort())
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'missing-document')?.path).toBe(join(root, 'ghost', 'ghost.agent.md'))

    const agent = list.find((definition) => definition.agentName === 'unexpected-id-agent')
    expect(agent?.extra).toEqual({ id: 'legacy-id' })
    expect(test.warnings.some((line) => line.includes('unexpected-id'))).toBe(true)
  })

  it('rejects a user-authored default directory and keeps the built-in one', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'default')
    writeAgent(test.bundled, 'default')

    const list = await test.registry.list({ cwd: test.project })
    const diagnostics = await test.registry.diagnostics({ cwd: test.project })

    expect(list.map((definition) => [definition.agentName, definition.source])).toEqual([['default', 'bundled']])
    expect(codes(diagnostics)).toEqual(['reserved-id'])
    expect(diagnostics[0]?.agentName).toBe('default')
    expect(diagnostics[0]?.providerId).toBe('project-dsh')
  })

  it('registers a document without frontmatter with all-default fields', async () => {
    const test = harness()
    const root = join(test.project, '.dsh', 'agents')
    write(join(root, 'naked', 'naked.agent.md'), '你是一个不加修饰的 agent。\n')

    const definition = await test.registry.get('naked', { cwd: test.project })

    expect(definition).toMatchObject({ agentName: 'naked', name: 'naked', description: '', body: '你是一个不加修饰的 agent。' })
    expect(definition?.modelOrder).toBeUndefined()
    expect(definition?.model).toBeUndefined()
    expect(codes(await test.registry.diagnostics({ cwd: test.project }))).toEqual(['no-model-order'])
  })

  it('flags a document whose known keys use unsupported constructs', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'broken', 'modelOrder: { fast: 1 }')

    const list = await test.registry.list({ cwd: test.project })
    const diagnostics = await test.registry.diagnostics({ cwd: test.project })

    expect(list).toEqual([])
    expect(codes(diagnostics)).toEqual(['unparseable-frontmatter'])
    expect(diagnostics[0]?.message).toContain('modelOrder')
  })

  it('registers an agent that only declares the legacy model chain', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'legacy', [
      'model:',
      '  - { provider: deepseek, model: deepseek-chat }',
    ].join('\n'))
    writeAgent(join(test.project, '.dsh', 'agents'), 'empty-chain', 'modelOrder: []')

    const legacy = await test.registry.get('legacy', { cwd: test.project })
    const empty = await test.registry.get('empty-chain', { cwd: test.project })

    expect(legacy?.model).toEqual([{ provider: 'deepseek', model: 'deepseek-chat' }])
    expect(empty?.modelOrder).toBeUndefined()
    expect(codes(await test.registry.diagnostics({ cwd: test.project }))).toEqual(['no-model-order'])
  })

  it('types the documented fields end to end', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'reviewer', [
      'name: 代码审查专家',
      'description: "按 DL 能够列风险的 reviewer"',
      'color: "#4f46e5"',
      'emoji: "🔍"',
      'modelOrder: [smart, fast]',
      'model:',
      '  - { provider: deepseek, model: deepseek-chat }',
      'requiredTools: [read, grep]',
      'skills: [code-review-checklist]',
      'spawn: fork',
      'reasoningEffort: high',
      'vibe: 冷静',
    ].join('\n'), '你是审查者。\n')

    const definition = await test.registry.get('reviewer', { cwd: test.project })

    expect(definition).toMatchObject({
      name: '代码审查专家',
      description: '按 DL 能够列风险的 reviewer',
      color: '#4f46e5',
      emoji: '🔍',
      modelOrder: ['smart', 'fast'],
      requiredTools: ['read', 'grep'],
      skills: ['code-review-checklist'],
      spawn: 'fork',
      reasoningEffort: 'high',
      body: '你是审查者。',
      extra: { vibe: '冷静' },
      providerId: 'project-dsh',
    })
    expect(definition?.path).toBe(join(test.project, '.dsh', 'agents', 'reviewer', 'reviewer.agent.md'))
    expect(await test.registry.diagnostics({ cwd: test.project })).toEqual([])
  })
})

describe('bundled root trust', () => {
  it('loads the shipped default through the same document pipeline', async () => {
    const providers = createAgentProviders()
    const nodeFileSystem = createNodeFileSystem()
    providers.registerAgentProvider(() =>
      createFileSystemAgentProvider({
        id: 'bundled',
        source: 'bundled',
        rank: BUNDLED_AGENT_RANK,
        trust: 'trusted',
        origin: 'built-in',
        resolveRoot: () => fileURLToPath(new URL('../bundled', import.meta.url)),
        selectFileSystem: () => nodeFileSystem,
      }),
    )
    const registry = createAgentRegistryService({ providers, nodeFileSystem })

    const definition = await registry.get('default')

    expect(definition).toMatchObject({
      agentName: 'default',
      source: 'bundled',
      origin: 'built-in',
      providerId: 'bundled',
      modelOrder: ['dsh-default'],
      body: '',
    })
    expect(definition?.requiredTools).toBeUndefined()
    expect(definition?.skills).toBeUndefined()
    expect(await registry.diagnostics()).toEqual([])
  })

  it('keeps a trusted agent with advisory findings instead of failing the scan', async () => {
    const test = harness()
    writeAgent(test.bundled, 'default', 'id: legacy-id\nmodelOrder: [dsh-default]', '')
    write(join(test.bundled, 'naked', 'naked.agent.md'), 'no chain here\n')

    const list = await test.registry.list({ cwd: test.project })
    const diagnostics = await test.registry.diagnostics({ cwd: test.project })

    // D21: only a *failed* trusted document is a hard error; an advisory finding
    // (`unexpected-id`, `no-model-order`) still registers the agent.
    expect(list.map((definition) => [definition.agentName, definition.source, definition.origin])).toEqual([
      ['default', 'bundled', 'built-in'],
      ['naked', 'bundled', 'built-in'],
    ])
    expect(codes(diagnostics).sort()).toEqual(['no-model-order', 'unexpected-id'])
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.providerId))).toEqual(new Set(['bundled']))
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'unexpected-id')?.agentName).toBe('default')
  })

  it('turns a broken bundled document into a hard error', async () => {
    const test = harness()
    writeAgent(test.bundled, 'default', 'modelOrder: { fast: 1 }')

    await expect(test.registry.list({ cwd: test.project })).rejects.toBeInstanceOf(AgentDocumentError)
  })

  it('still fails on a broken bundled document that a user root shadowed', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')
    writeAgent(test.bundled, 'alpha', 'modelOrder: { fast: 1 }')

    // A broken trusted asset is a packaging bug: the rank-100 workspace copy
    // must not be able to hide it by winning the name first.
    await expect(test.registry.list({ cwd: test.project })).rejects.toBeInstanceOf(AgentDocumentError)
  })

  it('turns a bundled directory without its document into a hard error', async () => {
    const test = harness()
    mkdirSync(join(test.bundled, 'default'), { recursive: true })

    await expect(test.registry.list({ cwd: test.project })).rejects.toBeInstanceOf(AgentDocumentError)
  })

  it('retries a failed trusted scan instead of caching the rejection forever', async () => {
    const test = harness()
    const documentPath = writeAgent(test.bundled, 'default', 'modelOrder: { fast: 1 }')

    await expect(test.registry.list({ cwd: test.project })).rejects.toBeInstanceOf(AgentDocumentError)

    write(documentPath, document('modelOrder: [dsh-default]', ''))

    const list = await test.registry.list({ cwd: test.project })
    expect(list.map((definition) => definition.agentName)).toEqual(['default'])
  })
})

describe('provider hot swap', () => {
  it('drops a provider on unregister and does not keep stale entries', async () => {
    const test = harness()
    writeAgent(join(test.dshHome, 'agents'), 'gamma')
    expect((await test.registry.list()).map((definition) => [definition.agentName, definition.providerId])).toEqual([
      ['gamma', 'user-dsh'],
    ])

    test.disposers['user-dsh']?.()

    expect(await test.registry.list()).toEqual([])
  })

  it('picks up a replacement provider registered after the first scan', async () => {
    const test = harness()
    writeAgent(join(test.dshHome, 'agents'), 'gamma')
    await test.registry.list()

    test.disposers['user-dsh']?.()
    writeAgent(join(test.agentsHome, 'agents'), 'delta')
    test.registerRoot('user-dsh', 'user-dsh', USER_DSH_RANK, 'untrusted', 'user', () => join(test.agentsHome, 'agents'))

    expect((await test.registry.list()).map((definition) => [definition.agentName, definition.source, definition.providerId])).toEqual([
      ['delta', 'user-dsh', 'user-dsh'],
    ])
  })

  it('rescans when a provider reports invalidation', async () => {
    const test = harness()
    test.disposers['user-dsh']?.()
    let control: ProviderControl | undefined
    test.providers.registerAgentProvider((value) => {
      control = value
      return createFileSystemAgentProvider({
        id: 'user-dsh',
        source: 'user-dsh',
        rank: USER_DSH_RANK,
        trust: 'untrusted',
        origin: 'user',
        resolveRoot: () => join(test.dshHome, 'agents'),
        selectFileSystem: () => createNodeFileSystem(),
      })
    })

    expect((await test.registry.list()).map((definition) => definition.agentName)).toEqual([])

    writeAgent(join(test.dshHome, 'agents'), 'gamma')
    expect((await test.registry.list()).map((definition) => definition.agentName)).toEqual([])

    control?.invalidate()
    expect((await test.registry.list()).map((definition) => definition.agentName)).toEqual(['gamma'])
  })
})

describe('lazy memoisation', () => {
  it('keeps the cached scan until invalidate', async () => {
    const test = harness()
    expect(await test.registry.list({ cwd: test.project })).toEqual([])

    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')

    expect(await test.registry.list({ cwd: test.project })).toEqual([])

    test.registry.invalidate()

    expect((await test.registry.list({ cwd: test.project })).map((definition) => definition.agentName)).toEqual(['alpha'])
  })

  it('scans once per project root across concurrent and repeated queries', async () => {
    const counter = countingFileSystem(createNodeFileSystem())
    const test = harness(() => counter.fileSystem)
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')
    // The bundled root is trusted, so it reads through Node directly and never
    // reaches the injected port: only the four untrusted roots are counted.
    const injectedRoots = 4

    const [first, second] = await Promise.all([
      test.registry.list({ cwd: test.project }),
      test.registry.list({ cwd: test.project }),
    ])
    expect(first).toEqual(second)
    expect(counter.listCalls()).toBe(injectedRoots)

    await test.registry.diagnostics({ cwd: test.project })
    expect(counter.listCalls()).toBe(injectedRoots)

    test.registry.invalidate()
    await test.registry.list({ cwd: test.project })
    expect(counter.listCalls()).toBe(injectedRoots * 2)
  })

  it('honours an already-aborted signal', async () => {
    const test = harness()

    await expect(test.registry.list({ cwd: test.project, signal: AbortSignal.abort() })).rejects.toThrow()
  })

  it('resolves the injected fs port at scan time, not at construction', async () => {
    const counter = countingFileSystem(createNodeFileSystem())
    let current: AgentFileSystem | undefined
    const test = harness(() => current)
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')

    // Before the host fs service appears, discovery falls back to Node.
    expect((await test.registry.list({ cwd: test.project })).map((definition) => definition.agentName)).toEqual(['alpha'])
    expect(counter.listCalls()).toBe(0)

    // A service mounted later must be picked up by the next scan (native reads
    // `optionalFileSystem(ctx)` at use time, so the port is not frozen at load).
    current = counter.fileSystem
    test.registry.invalidate()

    expect((await test.registry.list({ cwd: test.project })).map((definition) => definition.agentName)).toEqual(['alpha'])
    expect(counter.listCalls()).toBe(4)
  })

  it('memoises user-only scans separately from project scans', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')
    writeAgent(join(test.dshHome, 'agents'), 'gamma')

    expect((await test.registry.list()).map((definition) => definition.agentName)).toEqual(['gamma'])
    expect((await test.registry.list({ cwd: test.project })).map((definition) => definition.agentName)).toEqual(['alpha', 'gamma'])
  })
})

describe('home resolution', () => {
  it('prefers an explicit path, then a non-blank env var, then the default', () => {
    expect(resolveDshHome('/explicit', { DSH_HOME: '/from-env' })).toBe('/explicit')
    expect(resolveDshHome(undefined, { DSH_HOME: '/from-env' })).toBe('/from-env')
    expect(resolveDshHome(undefined, { DSH_HOME: '   ' })).toContain('.dsh')
    expect(resolveAgentsHome('~/.agents')).toContain('.agents')
  })

  it('walks up to the project root', async () => {
    const test = harness()
    const nested = join(test.project, 'packages', 'app', 'src')
    mkdirSync(nested, { recursive: true })

    await expect(findProjectRoot(nested, createNodeFileSystem())).resolves.toBe(test.project)
  })
})

describe('service surface', () => {
  it('exposes exactly the frozen methods', async () => {
    const test = harness()
    const surface = Object.keys(test.registry).sort()

    expect(surface).toEqual(['diagnostics', 'get', 'invalidate', 'list'])
    expect(typeof test.registry.list).toBe('function')
    expect(typeof test.registry.get).toBe('function')
    expect(typeof test.registry.diagnostics).toBe('function')
    expect(typeof test.registry.invalidate).toBe('function')
  })

  it('returns immutable-looking definitions with absolute paths', async () => {
    const test = harness()
    writeAgent(join(test.project, '.dsh', 'agents'), 'alpha')

    const list = await test.registry.list({ cwd: test.project })
    const definition = list[0] as AgentDefinition

    expect(definition.path.startsWith('/')).toBe(true)
    expect(list).toHaveLength(1)
  })
})
