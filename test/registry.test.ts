import { describe, expect, it } from 'vitest'

import { createAgentRegistry, type AgentDefinition } from '../src/registry.ts'

const planAgent: AgentDefinition = {
  id: 'plan',
  description: 'Plans work before it is delegated',
  source: 'workspace:.dsh/agents',
}

const reviewAgent: AgentDefinition = {
  id: 'review',
  description: 'Reviews finished work',
  source: 'user:~/.dsh/agents',
}

describe('agent registry container', () => {
  it('starts empty, so the scaffold ships an empty registration point', () => {
    const registry = createAgentRegistry()

    expect(registry.size).toBe(0)
    expect(registry.list()).toEqual([])
    expect(registry.get('default')).toBeUndefined()
  })

  it('serves a registered definition by id', () => {
    const registry = createAgentRegistry()

    registry.register(planAgent)

    expect(registry.size).toBe(1)
    expect(registry.get('plan')).toEqual(planAgent)
    expect(registry.list()).toEqual([planAgent])
  })

  it('keeps the first-registration position and lets the last registration win by id', () => {
    const registry = createAgentRegistry()
    registry.register(planAgent)
    registry.register(reviewAgent)

    const redefined: AgentDefinition = { ...planAgent, description: 'Plans and delegates work' }
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
