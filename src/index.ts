import type { Context } from '@deepseek-ai/cordis'

import { createAgentRegistry, type AgentDefinition, type AgentRegistry } from './registry.ts'

/**
 * Service key of the agent-definition registry.
 *
 * Deliberately NOT `agents`: the host already registers the live Agent registry
 * under that key (`ctx.agents`), and a bundle must not shadow a native service.
 */
export const AGENT_REGISTRY_SERVICE = 'agentRegistry'

/**
 * Host plugin entry. Registers the empty definition registry on the calling
 * context and hands its disposal to Cordis, so unloading the plugin removes the
 * service again.
 */
export function apply(ctx: Context): void {
  const registry = createAgentRegistry()
  ctx.effect(() => ctx.provide(AGENT_REGISTRY_SERVICE, registry))
}

export { createAgentRegistry }
export type { AgentDefinition, AgentRegistry }
