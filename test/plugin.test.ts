import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_CONTROL_SERVICE,
  AGENT_PROVIDERS_SERVICE,
  AGENT_REGISTRY_SERVICE,
  ALIAS_REGISTRY_SERVICE,
  apply,
} from '../src/index.ts'
import { createAgentProviders } from '../src/core/providers-registry.ts'
import { apply as providerRowApply, applyProviders } from '../src/dsh/host/providers.ts'
import { SERVICE_API_VERSION } from '../src/contract/index.ts'
import type { AgentRegistry, AliasRegistry } from '../src/contract/types.ts'
import type { AgentProviders } from '../src/contract/index.ts'

async function mounted(): Promise<{
  ctx: Context
  registry: AgentRegistry
  aliasRegistry: AliasRegistry
  providers: AgentProviders
  control: Record<string, unknown>
}> {
  const ctx = new Context()
  await ctx.plugin({ apply })
  const registry = ctx.get(AGENT_REGISTRY_SERVICE) as AgentRegistry | undefined
  if (registry === undefined) throw new Error('agent registry service was not registered')
  const aliasRegistry = ctx.get(ALIAS_REGISTRY_SERVICE) as AliasRegistry | undefined
  if (aliasRegistry === undefined) throw new Error('alias registry service was not registered')
  const providers = ctx.get(AGENT_PROVIDERS_SERVICE) as AgentProviders | undefined
  if (providers === undefined) throw new Error('agent providers service was not registered')
  const control = ctx.get(AGENT_CONTROL_SERVICE) as Record<string, unknown> | undefined
  if (control === undefined) throw new Error('agent control service was not registered')
  return { ctx, registry, aliasRegistry, providers, control }
}

/** One throwaway directory under the OS temp dir. */
function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-atelier-plugin-'))
}

/** The provider row exactly as the loader mounts it: a plugin object with `inject` + the module's `apply` entry. */
function providerRow(): { inject: readonly string[]; apply: typeof providerRowApply } {
  return { inject: [AGENT_PROVIDERS_SERVICE], apply: providerRowApply }
}

describe('agent-atelier plugin', () => {
  it('registers the lazy agent registry on the host context', async () => {
    const { registry } = await mounted()

    expect(typeof registry.list).toBe('function')
    expect(typeof registry.get).toBe('function')
    expect(typeof registry.diagnostics).toBe('function')
    expect(typeof registry.invalidate).toBe('function')
    // The frozen service face has no `size`; that stays on the internal container.
    expect(Object.keys(registry).sort()).toEqual(['diagnostics', 'get', 'invalidate', 'list'])
  })

  it('owns its own service keys instead of the native agents service', () => {
    // ctx.agents already exists on the host (live Agent registry), so the
    // scaffold must never register itself under that key.
    expect(AGENT_REGISTRY_SERVICE).toBe('agentRegistry')
    expect(AGENT_REGISTRY_SERVICE).not.toBe('agents')
    // The alias registry follows the same rule, under its own key.
    expect(ALIAS_REGISTRY_SERVICE).toBe('aliasRegistry')
    expect(ALIAS_REGISTRY_SERVICE).not.toBe('agents')
    expect(ALIAS_REGISTRY_SERVICE).not.toBe(AGENT_REGISTRY_SERVICE)
    // The provider registry is a plain object, under its own key too.
    expect(AGENT_PROVIDERS_SERVICE).toBe('agentProviders')
    expect(AGENT_PROVIDERS_SERVICE).not.toBe(AGENT_REGISTRY_SERVICE)
    // The control core is the fourth host service, under its own key.
    expect(AGENT_CONTROL_SERVICE).toBe('agentControl')
    expect(AGENT_CONTROL_SERVICE).not.toBe(AGENT_REGISTRY_SERVICE)
  })

  it('provides the six-member agentControl write face plus the session-start member', async () => {
    const { control } = await mounted()

    // Ticket 19 adds one optional seventh member on top of ticket 11's six; the
    // six keep their exact names and shapes.
    expect(Object.keys(control).sort()).toEqual([
      'applyRegistryEdit',
      'commit',
      'compose',
      'composeSession',
      'invalidate',
      'plan',
      'snapshot',
    ])
  })

  it('mounts only the control routes when the bare client row asks for role ui-host', () => {
    const ctx = new Context()
    const routes: string[] = []
    ctx.provide(AGENT_CONTROL_SERVICE, {})
    ctx.provide('webServer', {
      register(route: { path: string }) {
        routes.push(route.path)
        return () => {}
      },
    })

    apply(ctx, { role: 'ui-host' })

    expect(routes).toHaveLength(6)
    // The ui-host row must not mount the registries a second time.
    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeUndefined()
  })

  it('provides agentProviders as a plain object service, not a Service instance', async () => {
    const { providers } = await mounted()

    expect(providers.apiVersion).toBe(SERVICE_API_VERSION)
    expect(Object.keys(providers).sort()).toEqual(['apiVersion', 'listAgentProviders', 'onChange', 'registerAgentProvider'])
    expect(providers.listAgentProviders().map((provider) => provider.id).sort()).toEqual([
      'bundled',
      'project-agents',
      'project-dsh',
      'user-agents',
      'user-dsh',
    ])
  })

  it('registers the alias registry with the frozen read face', async () => {
    const { aliasRegistry } = await mounted()

    expect(Object.keys(aliasRegistry).sort()).toEqual(['diagnostics', 'getAlias', 'getModel', 'invalidate', 'snapshot'])
  })

  it('resolves the built-in dsh-default alias from a default-model service mounted after the plugin', async () => {
    const home = scratchDir()
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents-home'))
    try {
      const { ctx, aliasRegistry } = await mounted()
      // The host context has no agentDefaultModel service, so there is no pair
      // to point at and therefore no built-in alias — nothing is invented.
      expect(await aliasRegistry.getAlias('dsh-default')).toBeUndefined()

      ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'volcengine-plan', model: 'glm-5.3' }) })
      aliasRegistry.invalidate()

      // readDefaultPair runs per load, so invalidate() is what makes the pair follow.
      expect(await aliasRegistry.getAlias('dsh-default')).toMatchObject({ targets: ['dsh-default'], source: 'built-in' })
      expect(await aliasRegistry.getModel('dsh-default')).toMatchObject({
        provider: 'volcengine-plan',
        model: 'glm-5.3',
        available: true,
        synthesized: true,
      })
    } finally {
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not launder agents into the native skills surface (ADR-0001)', async () => {
    const { ctx } = await mounted()

    expect(ctx.get('skills')).toBeUndefined()
  })

  it('finds the bundled default agent through the real plugin wiring', async () => {
    // The user roots come from $DSH_HOME / $DSH_AGENTS_HOME: pin them to a
    // throwaway home so the test never reads the machine's real ~/.dsh or
    // ~/.agents, and assert nothing else shows up.
    const home = scratchDir()
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents-home'))
    try {
      const { registry } = await mounted()

      const definition = await registry.get('default')

      expect(definition).toMatchObject({
        agentName: 'default',
        source: 'bundled',
        origin: 'built-in',
        providerId: 'bundled',
        modelOrder: ['dsh-default'],
      })
      expect((await registry.list()).map((entry) => entry.agentName)).toEqual(['default'])
    } finally {
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reads through an fs service mounted after the plugin, not through Node', async () => {
    const project = scratchDir()
    try {
      mkdirSync(join(project, '.git'), { recursive: true })
      mkdirSync(join(project, '.dsh', 'agents', 'alpha'), { recursive: true })
      writeFileSync(join(project, '.dsh', 'agents', 'alpha', 'alpha.agent.md'), '---\nmodelOrder: [fast]\n---\nalpha body\n')

      const { ctx, registry } = await mounted()
      let resolveCalls = 0
      // A service mounted *after* the plugin: the port must be resolved at scan
      // time (native `optionalFileSystem(ctx)`), not captured in `apply()`.
      ctx.provide('fs', {
        resolve: async (path: string) => {
          resolveCalls += 1
          return path
        },
        listDir: async () => [],
        stat: async () => undefined,
        readText: async () => '',
      })

      // Node would have found `alpha` in the project root; the fake service
      // reports an empty world, so only the trusted bundled root shows up.
      expect((await registry.list({ cwd: project })).map((entry) => entry.agentName)).toEqual(['default'])
      expect(resolveCalls).toBeGreaterThan(0)
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })

  it('removes the registry and the providers again when the plugin unloads', async () => {
    const ctx = new Context()
    const fork = await ctx.plugin({ apply })
    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeDefined()
    expect(ctx.get(ALIAS_REGISTRY_SERVICE)).toBeDefined()
    expect((ctx.get(AGENT_PROVIDERS_SERVICE) as AgentProviders).listAgentProviders()).toHaveLength(5)

    await fork.dispose()

    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeUndefined()
    expect(ctx.get(ALIAS_REGISTRY_SERVICE)).toBeUndefined()
    expect(ctx.get(AGENT_PROVIDERS_SERVICE)).toBeUndefined()
  })
})

describe('provider plugin row', () => {
  it('exports loader-compatible named exports', async () => {
    const coreRow = await import('../src/dsh/host/core.ts')
    const row = await import('../src/dsh/host/providers.ts')

    expect(typeof coreRow.apply).toBe('function')
    expect(typeof row.apply).toBe('function')
    expect(row.inject).toEqual(['agentProviders'])
    // The row entry is its own function — never the instance-accepting alias,
    // because the loader calls apply(ctx, config) and the config must not be
    // mistaken for a handed-over service instance.
    expect(row.apply).not.toBe(row.applyProviders)
    expect(row.apply.length).toBeLessThanOrEqual(2)
    // No default export: the loader would unwrap only `default` and drop `inject`.
    expect('default' in coreRow && coreRow.default !== undefined).toBe(false)
    expect('default' in row && row.default !== undefined).toBe(false)
  })

  it('registers the five default providers and unregisters them on unload', async () => {
    const ctx = new Context()
    const providers = createAgentProviders()
    ctx.provide(AGENT_PROVIDERS_SERVICE, providers)

    const fork = await ctx.plugin(providerRow())

    expect(providers.listAgentProviders().map((provider) => provider.id).sort()).toEqual([
      'bundled',
      'project-agents',
      'project-dsh',
      'user-agents',
      'user-dsh',
    ])

    await fork.dispose()

    expect(providers.listAgentProviders()).toEqual([])
  })

  it('mounts through the loader contract: apply(ctx, config) with a truthy row config', async () => {
    const ctx = new Context()
    const providers = createAgentProviders()
    ctx.provide(AGENT_PROVIDERS_SERVICE, providers)

    // The host loader calls the row entry as apply(ctx, config) — the row's
    // YAML config `{}` is a truthy object that must never be mistaken for a
    // handed-over service instance (the 2026-10-19 host activation failure).
    const fork = await ctx.plugin(providerRow(), {})

    expect(providers.listAgentProviders()).toHaveLength(5)
    await fork.dispose()
    expect(providers.listAgentProviders()).toEqual([])
  })

  it('throws a clear error when the service is missing', async () => {
    const ctx = new Context()

    expect(() => applyProviders(ctx)).toThrow(/agentProviders/)
  })

  it('stays pending until the agentProviders service appears', async () => {
    const ctx = new Context()
    const providers = createAgentProviders()

    const fork = await ctx.plugin(providerRow())
    expect(providers.listAgentProviders()).toEqual([])

    ctx.provide(AGENT_PROVIDERS_SERVICE, providers)
    await vi.waitFor(() => expect(providers.listAgentProviders()).toHaveLength(5))

    await fork.dispose()
    expect(providers.listAgentProviders()).toEqual([])
  })

  it('reads the trusted bundled root through Node even when an fs service is mounted', async () => {
    const home = scratchDir()
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents-home'))
    try {
      const ctx = new Context()
      const providers = createAgentProviders()
      ctx.provide(AGENT_PROVIDERS_SERVICE, providers)
      // A host fs service reporting an empty world: everything untrusted that
      // reads through it must see nothing.
      ctx.provide('fs', {
        resolve: async (path: string) => path,
        listDir: async () => [],
        stat: async () => undefined,
        readText: async () => '',
      })
      await ctx.plugin(providerRow())

      // The trusted bundled root pins Node, so the shipped agent is visible
      // even though the fake host fs would hide it. The listing is raw: the
      // provider reports the bundled README too and leaves classification to
      // the registry.
      const bundled = providers.listAgentProviders().find((provider) => provider.id === 'bundled')
      const entries = await bundled?.listEntries({})
      expect(entries?.map((entry) => entry.name).sort()).toEqual(['README.md', 'default'])
      expect(entries?.find((entry) => entry.name === 'default')).toMatchObject({ kind: 'directory', providerId: 'bundled' })

      // An untrusted root goes through the host fs: the fake reports an empty
      // directory where Node would report a missing one (`undefined`).
      const userDsh = providers.listAgentProviders().find((provider) => provider.id === 'user-dsh')
      await expect(userDsh?.listEntries({})).resolves.toEqual([])
    } finally {
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })
})
