/**
 * The plain-object provider registry behind `ctx.agentProviders` (ticket 18).
 *
 * A plain object on purpose: provider rows `inject` it without touching the
 * `Service` catalog (2026-10-18 probe, `docs/agents/harness-facts.md`). It
 * keeps membership only — duplicate `id` and duplicate agent `source` throw,
 * `rank` orders the listing, and every membership or data change fires
 * `onChange` so the consuming registries can drop their caches.
 */

import { SERVICE_API_VERSION } from '../contract/index.ts'

import type {
  AgentProviders,
  AgentSourceProvider,
  ProviderControl,
} from '../contract/index.ts'

export function createAgentProviders(): AgentProviders {
  const providers: AgentSourceProvider[] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    apiVersion: SERVICE_API_VERSION,
    registerAgentProvider(create) {
      const controller = new AbortController()
      const control: ProviderControl = {
        signal: controller.signal,
        invalidate: notify,
      }
      const provider = create(control)
      const byId = providers.find((existing) => existing.id === provider.id)
      if (byId !== undefined) {
        // The factory already ran and holds the control handle; abort it so a
        // rejected registration cannot leak a live signal.
        controller.abort()
        throw new Error(`agent provider "${provider.id}" is already registered`)
      }
      const bySource = providers.find((existing) => existing.source === provider.source)
      if (bySource !== undefined) {
        controller.abort()
        throw new Error(`agent source "${provider.source}" is already served by provider "${bySource.id}"`)
      }
      providers.push(provider)
      notify()
      return () => {
        const index = providers.indexOf(provider)
        if (index >= 0) providers.splice(index, 1)
        controller.abort()
        notify()
      }
    },
    listAgentProviders: () =>
      [...providers].sort((left, right) => left.rank - right.rank),
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
