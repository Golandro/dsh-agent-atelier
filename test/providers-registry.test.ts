import { describe, expect, it } from 'vitest'

import { createAgentProviders } from '../src/core/providers-registry.ts'
import { SERVICE_API_VERSION } from '../src/contract/index.ts'
import type { AgentSource, AgentSourceProvider, ProviderControl } from '../src/contract/index.ts'

/** A minimal in-memory provider: enough to exercise the registry's bookkeeping. */
function fakeProvider(id: string, source: AgentSource, rank: number, entries: readonly string[] = []): AgentSourceProvider {
  return {
    id,
    source,
    rank,
    trust: 'untrusted',
    origin: 'user',
    format: 'agent-md',
    apiVersion: SERVICE_API_VERSION,
    listEntries: async () => entries.map((name) => ({ name, kind: 'directory' as const, path: `/${name}`, providerId: id })),
    readDocument: async (entry) => ({ kind: 'missing', path: `${entry.path}/${entry.name}.agent.md`, reason: 'absent' as const }),
  }
}

describe('createAgentProviders', () => {
  it('exposes the plain-object service shape', () => {
    const providers = createAgentProviders()

    expect(providers.apiVersion).toBe(SERVICE_API_VERSION)
    expect(typeof providers.registerAgentProvider).toBe('function')
    expect(typeof providers.listAgentProviders).toBe('function')
    expect(typeof providers.onChange).toBe('function')
    expect(providers.listAgentProviders()).toEqual([])
  })

  it('lists providers rank-ascending, then registration order', () => {
    const providers = createAgentProviders()
    providers.registerAgentProvider(() => fakeProvider('late', 'user-dsh', 400))
    providers.registerAgentProvider(() => fakeProvider('first-low', 'user-agents', 100))
    providers.registerAgentProvider(() => fakeProvider('second-low', 'bundled', 100))

    expect(providers.listAgentProviders().map((provider) => provider.id)).toEqual(['first-low', 'second-low', 'late'])
  })

  it('throws on a duplicate id', () => {
    const providers = createAgentProviders()
    providers.registerAgentProvider(() => fakeProvider('same-id', 'user-dsh', 400))

    expect(() => providers.registerAgentProvider(() => fakeProvider('same-id', 'user-agents', 500))).toThrow(/same-id/)
    expect(providers.listAgentProviders()).toHaveLength(1)
  })

  it('throws on a duplicate agent source', () => {
    const providers = createAgentProviders()
    providers.registerAgentProvider(() => fakeProvider('first', 'user-dsh', 400))

    expect(() => providers.registerAgentProvider(() => fakeProvider('second', 'user-dsh', 100))).toThrow(/user-dsh/)
    expect(providers.listAgentProviders().map((provider) => provider.id)).toEqual(['first'])
  })

  it('unregisters through the disposer and aborts the control signal', () => {
    const providers = createAgentProviders()
    let control: ProviderControl | undefined
    const dispose = providers.registerAgentProvider((value) => {
      control = value
      return fakeProvider('bundled', 'bundled', 600)
    })

    expect(providers.listAgentProviders()).toHaveLength(1)
    expect(control?.signal.aborted).toBe(false)

    dispose()

    expect(providers.listAgentProviders()).toEqual([])
    expect(control?.signal.aborted).toBe(true)
    expect(() => dispose()).not.toThrow()
  })

  it('fires onChange on register, unregister and control invalidation', () => {
    const providers = createAgentProviders()
    const events: string[] = []
    const stop = providers.onChange(() => events.push('change'))

    let control: ProviderControl | undefined
    const dispose = providers.registerAgentProvider((value) => {
      control = value
      return fakeProvider('user-dsh', 'user-dsh', 400)
    })
    expect(events).toEqual(['change'])

    control?.invalidate()
    expect(events).toEqual(['change', 'change'])

    dispose()
    expect(events).toEqual(['change', 'change', 'change'])

    stop()
    control?.invalidate()
    expect(events).toEqual(['change', 'change', 'change'])
  })

  it('hands the registered provider objects through unchanged', async () => {
    const providers = createAgentProviders()
    providers.registerAgentProvider(() => fakeProvider('project-dsh', 'project-dsh', 100, ['alpha']))

    const [provider] = providers.listAgentProviders()
    expect(provider?.id).toBe('project-dsh')
    await expect(provider?.listEntries({})).resolves.toEqual([
      { name: 'alpha', kind: 'directory', path: '/alpha', providerId: 'project-dsh' },
    ])
  })
})
