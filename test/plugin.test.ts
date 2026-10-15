import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { AGENT_REGISTRY_SERVICE, apply } from '../src/index.ts'
import type { AgentRegistry } from '../src/types.ts'

async function mounted(): Promise<{ ctx: Context; registry: AgentRegistry }> {
  const ctx = new Context()
  await ctx.plugin({ apply })
  const registry = ctx.get(AGENT_REGISTRY_SERVICE) as AgentRegistry | undefined
  if (registry === undefined) throw new Error('agent registry service was not registered')
  return { ctx, registry }
}

/** One throwaway directory under the OS temp dir. */
function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'agents-manager-plugin-'))
}

describe('agents-manager plugin', () => {
  it('registers the lazy agent registry on the host context', async () => {
    const { registry } = await mounted()

    expect(typeof registry.list).toBe('function')
    expect(typeof registry.get).toBe('function')
    expect(typeof registry.diagnostics).toBe('function')
    expect(typeof registry.invalidate).toBe('function')
    // The frozen service face has no `size`; that stays on the internal container.
    expect(Object.keys(registry).sort()).toEqual(['diagnostics', 'get', 'invalidate', 'list'])
  })

  it('owns its own service key instead of the native agents service', () => {
    // ctx.agents already exists on the host (live Agent registry), so the
    // scaffold must never register itself under that key.
    expect(AGENT_REGISTRY_SERVICE).toBe('agentRegistry')
    expect(AGENT_REGISTRY_SERVICE).not.toBe('agents')
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

      expect(definition).toMatchObject({ agentName: 'default', source: 'bundled', origin: 'built-in', modelOrder: ['dsh-default'] })
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

  it('removes the registry again when the plugin unloads', async () => {
    const ctx = new Context()
    const fork = await ctx.plugin({ apply })
    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeDefined()

    await fork.dispose()

    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeUndefined()
  })
})
