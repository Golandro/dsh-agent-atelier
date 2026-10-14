import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { AGENT_REGISTRY_SERVICE, apply } from '../src/index.ts'
import type { AgentRegistry } from '../src/registry.ts'

describe('agents-manager plugin', () => {
  it('registers an empty agent registry on the host context', async () => {
    const ctx = new Context()

    await ctx.plugin({ apply })

    const registry = ctx.get(AGENT_REGISTRY_SERVICE) as AgentRegistry | undefined
    expect(registry?.size).toBe(0)
    expect(registry?.list()).toEqual([])
    expect(registry?.get('default')).toBeUndefined()
  })

  it('owns its own service key instead of the native agents service', () => {
    // ctx.agents already exists on the host (live Agent registry), so the
    // scaffold must never register itself under that key.
    expect(AGENT_REGISTRY_SERVICE).toBe('agentRegistry')
    expect(AGENT_REGISTRY_SERVICE).not.toBe('agents')
  })

  it('removes the registry again when the plugin unloads', async () => {
    const ctx = new Context()
    const fork = await ctx.plugin({ apply })
    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeDefined()

    await fork.dispose()

    expect(ctx.get(AGENT_REGISTRY_SERVICE)).toBeUndefined()
  })
})
