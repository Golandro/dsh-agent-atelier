import { describe, expect, it } from 'vitest'

import { createAgentRegistry } from '../src/core/catalog/registry.ts'
import type { AgentDefinition } from '../src/contract/types.ts'

function definition(agentName: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentName,
    name: agentName,
    description: `${agentName} agent`,
    body: `${agentName} body`,
    source: 'user-dsh',
    origin: 'user',
    extra: {},
    path: `/agents/${agentName}/${agentName}.agent.md`,
    ...overrides,
  }
}

const planAgent = definition('plan', { description: 'Plans work before it is delegated' })
const reviewAgent = definition('review', { description: 'Reviews finished work', source: 'user-agents' })

describe('agent registry container', () => {
  it('starts empty', () => {
    const registry = createAgentRegistry()

    expect(registry.size).toBe(0)
    expect(registry.list()).toEqual([])
    expect(registry.get('plan')).toBeUndefined()
  })

  it('serves a registered definition by agent name', () => {
    const registry = createAgentRegistry()

    registry.register(planAgent)

    expect(registry.size).toBe(1)
    expect(registry.get('plan')).toEqual(planAgent)
    expect(registry.list()).toEqual([planAgent])
  })

  it('keeps the first-registration position and lets the last registration win by agent name', () => {
    const registry = createAgentRegistry()
    registry.register(planAgent)
    registry.register(reviewAgent)

    const redefined = definition('plan', { description: 'Plans and delegates work' })
    registry.register(redefined)

    expect(registry.list()).toEqual([redefined, reviewAgent])
    expect(registry.get('plan')).toEqual(redefined)
    expect(registry.size).toBe(2)
  })

  it('hands out a list callers cannot use to reach into the registry', () => {
    const registry = createAgentRegistry()
    registry.register(planAgent)

    const listed = registry.list() as AgentDefinition[]
    listed.length = 0

    expect(registry.list()).toEqual([planAgent])
    expect(registry.size).toBe(1)
  })
})
