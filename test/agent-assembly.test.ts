/**
 * 票 04 的两道门：纯规划器（节序快照 / 断点 / lint / 确定性）与兼容注册
 * sink（全量替换 / 回滚 / disposer / 插值标记）。注册 sink 用假 scope，
 * 真机遮蔽留给 profile 验收。
 */
import { describe, expect, it } from 'vitest'

import {
  MODEL_SYSTEM_SECTION,
  PERSONA_SECTION,
  createAssemblyService,
  planAssembly,
} from '../src/agent-assembly/index.ts'

import type {
  AgentDefinition,
  AssemblyScope,
  AssemblySectionRegistration,
  AssemblySession,
  ModelDefinition,
} from '../src/contract/index.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }

function agentDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentName: 'atlas',
    name: 'Atlas',
    description: 'code reviewer',
    body: 'You review code.',
    source: 'project-dsh',
    origin: 'user',
    providerId: 'test',
    extra: {},
    path: '/fixtures/atlas/atlas.agent.md',
    ...overrides,
  }
}

function modelDefinition(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    modelName: 'chat',
    provider: 'deepseek',
    model: 'deepseek-chat',
    sysPrompt: 'Provider {{provider}} runs {{model}}; keep {{unknown}} literal.',
    available: true,
    source: 'user-dsh',
    ...overrides,
  }
}

function session(overrides: Partial<AssemblySession> = {}): AssemblySession {
  return {
    agent: agentDefinition(),
    parameters: { route: ROUTE, persona: 'You review code.' },
    model: modelDefinition(),
    ...overrides,
  }
}

/** A scoped registrar that records calls, shadows by name and can fail on demand. */
interface FakeScope {
  readonly scope: AssemblyScope
  readonly active: Map<string, AssemblySectionRegistration>
  readonly calls: AssemblySectionRegistration[]
  readonly disposed: string[]
}

function fakeScope(options: { readonly failOn?: string | undefined } = {}): FakeScope {
  const active = new Map<string, AssemblySectionRegistration>()
  const calls: AssemblySectionRegistration[] = []
  const disposed: string[] = []
  const scope: AssemblyScope = {
    systemPrompt: {
      section(section) {
        calls.push(section)
        if (section.name === options.failOn) throw new Error(`cannot register ${section.name}`)
        if (active.has(section.name)) throw new Error(`duplicate section in one scope: ${section.name}`)
        active.set(section.name, section)
        return () => {
          disposed.push(section.name)
          active.delete(section.name)
        }
      },
      getSectionOrder(name) {
        return name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : -1
      },
    },
  }
  return { scope, active, calls, disposed }
}

describe('planAssembly: fixed row set and placement', () => {
  it('lists the recommended cache layering with host orders on system rows only', () => {
    const plan = planAssembly(session())

    expect(plan.sections.map((section) => section.name)).toEqual([
      'atelier:model-sys',
      'channel:tools',
      'deployment:persona-prefix',
      'atelier:skills',
      'channel:digest',
      'channel:first-message',
      'channel:pre-step',
    ])
    expect(plan.sections.map((section) => section.channel)).toEqual([
      'system',
      'tools',
      'system',
      'system',
      'digest',
      'first-message',
      'pre-step',
    ])
    expect(plan.sections.map((section) => section.order)).toEqual([-500, 0, 0, 100, 0, 0, 0])
    expect(plan.sections.map((section) => section.executable)).toEqual([true, false, true, false, false, false, false])
    expect(plan.sections.map((section) => section.variesWith)).toEqual([
      ['model'],
      ['tools'],
      ['agent'],
      ['agent'],
      ['registry'],
      [],
      [],
    ])
  })

  it('keeps the persona row even when its text is empty, for shadowing', () => {
    const plan = planAssembly(session({ parameters: { route: ROUTE, persona: '' } }))
    const persona = plan.sections.find((section) => section.name === PERSONA_SECTION)

    expect(persona).toMatchObject({ text: '', executable: true, order: 0 })
  })

  it('drops the model row when the winning entry has no sysPrompt', () => {
    const plan = planAssembly(session({ model: modelDefinition({ sysPrompt: undefined }) }))

    expect(plan.sections.some((section) => section.name === MODEL_SYSTEM_SECTION)).toBe(false)
    expect(plan.sections.map((section) => section.name)).not.toContain(MODEL_SYSTEM_SECTION)
    expect(plan.breakpoints.some((breakpoint) => breakpoint.dimension === 'model')).toBe(false)
  })

  it('substitutes provider and model only, leaving other host variables literal', () => {
    const plan = planAssembly(session())
    const modelRow = plan.sections.find((section) => section.name === MODEL_SYSTEM_SECTION)

    expect(modelRow?.text).toBe('Provider deepseek runs deepseek-chat; keep {{unknown}} literal.')
    expect(plan.sections.find((section) => section.name === PERSONA_SECTION)?.text).toBe('You review code.')
  })

  it('is deterministic: the same session and config give the same plan', () => {
    const first = planAssembly(session())
    const second = planAssembly(session())

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('planAssembly: sectionOrder overrides', () => {
  it('puts listed rows first, renumbers system rows by array index and lints the volatile-first order', () => {
    const plan = planAssembly(session(), {
      sectionOrder: [PERSONA_SECTION, MODEL_SYSTEM_SECTION],
    })

    expect(plan.sections.map((section) => section.name)).toEqual([
      'deployment:persona-prefix',
      'atelier:model-sys',
      'channel:tools',
      'atelier:skills',
      'channel:digest',
      'channel:first-message',
      'channel:pre-step',
    ])
    const systemOrders = plan.sections
      .filter((section) => section.channel === 'system')
      .map((section) => [section.name, section.order])
    expect(systemOrders).toEqual([
      [PERSONA_SECTION, 0],
      [MODEL_SYSTEM_SECTION, 1],
      ['atelier:skills', 3],
    ])
    expect(plan.sections.filter((section) => section.channel !== 'system').map((section) => section.order))
      .toEqual([0, 0, 0, 0])
    expect(plan.lints).toHaveLength(1)
    expect(plan.lints[0]).toMatchObject({
      code: 'volatile-before-stable',
      severity: 'warning',
      channel: 'system',
      section: PERSONA_SECTION,
    })
    expect(plan.lints[0]?.message).toContain(MODEL_SYSTEM_SECTION)
  })

  it('waives the lint when the offending entry is marked cacheIsolated', () => {
    const plan = planAssembly(session(), {
      sectionOrder: [{ name: PERSONA_SECTION, cacheIsolated: true }, MODEL_SYSTEM_SECTION],
    })

    expect(plan.lints).toEqual([])
    expect(plan.sections.find((section) => section.name === PERSONA_SECTION)?.cacheIsolated).toBe(true)
    // The exemption is advisory only: the placement itself is untouched.
    expect(plan.sections.map((section) => section.name).slice(0, 2)).toEqual([PERSONA_SECTION, MODEL_SYSTEM_SECTION])
  })

  it('ignores unknown, duplicate and malformed entries', () => {
    const plan = planAssembly(session(), {
      sectionOrder: [
        'ghost',
        MODEL_SYSTEM_SECTION,
        MODEL_SYSTEM_SECTION,
        'ghost',
        { name: 'another-ghost' },
      ],
    })

    expect(plan.sections.map((section) => section.name)).toEqual([
      'atelier:model-sys',
      'channel:tools',
      'deployment:persona-prefix',
      'atelier:skills',
      'channel:digest',
      'channel:first-message',
      'channel:pre-step',
    ])
    expect(plan.lints).toEqual([])
  })

  it('keeps the recommended order when the override names no existing row', () => {
    const recommended = planAssembly(session())
    const plan = planAssembly(session(), { sectionOrder: ['ghost'] })

    expect(plan).toEqual(recommended)
  })
})

describe('planAssembly: breakpoints', () => {
  it('reports the first dependent row of each dimension in stable dimension order', () => {
    const plan = planAssembly(session())

    expect(plan.breakpoints).toEqual([
      { dimension: 'model', channel: 'system', section: MODEL_SYSTEM_SECTION },
      { dimension: 'agent', channel: 'system', section: PERSONA_SECTION },
      { dimension: 'registry', channel: 'digest', section: 'channel:digest' },
      { dimension: 'tools', channel: 'tools', section: 'channel:tools' },
    ])
  })

  it('scans the overridden array order when computing breakpoints', () => {
    const plan = planAssembly(session(), { sectionOrder: [PERSONA_SECTION, MODEL_SYSTEM_SECTION] })

    expect(plan.breakpoints.map((breakpoint) => [breakpoint.dimension, breakpoint.section])).toEqual([
      ['model', MODEL_SYSTEM_SECTION],
      ['agent', PERSONA_SECTION],
      ['registry', 'channel:digest'],
      ['tools', 'channel:tools'],
    ])
  })
})

describe('createAssemblyService: compat registration', () => {
  it('registers the executable system rows, model first, with the right interpolation flags', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope()

    const registration = await assembly.registerAssemblySections({ scope: fake.scope, session: session() })

    expect(fake.calls.map((call) => call.name)).toEqual([MODEL_SYSTEM_SECTION, PERSONA_SECTION])
    expect(fake.calls[0]).toMatchObject({ name: MODEL_SYSTEM_SECTION, order: -500, interpolate: false })
    expect('interpolate' in (fake.calls[1] ?? {})).toBe(false)
    expect(fake.calls[1]).toMatchObject({ name: PERSONA_SECTION, order: 0, text: 'You review code.' })
    expect(registration.agentName).toBe('atlas')
    expect(registration.plan).toEqual(assembly.plan(session()))
  })

  it('registers an empty persona anyway, so the deployment prefix is shadowed', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope()

    await assembly.registerAssemblySections({
      scope: fake.scope,
      session: session({ model: undefined, parameters: { route: ROUTE, persona: '' } }),
    })

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toMatchObject({ name: PERSONA_SECTION, text: '' })
    expect(fake.active.has(PERSONA_SECTION)).toBe(true)
  })

  it('registers no model row when the entry has no sysPrompt', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope()

    await assembly.registerAssemblySections({
      scope: fake.scope,
      session: session({ model: modelDefinition({ sysPrompt: undefined }) }),
    })

    expect(fake.calls.map((call) => call.name)).toEqual([PERSONA_SECTION])
  })

  it('replaces the previous mount whole: old rows are disposed before the new ones', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope()
    const first = await assembly.registerAssemblySections({ scope: fake.scope, session: session() })
    const disposedBeforeReplacement = [...fake.disposed]

    const second = await assembly.registerAssemblySections({
      scope: fake.scope,
      session: session({ parameters: { route: ROUTE, persona: 'Second persona.' } }),
    })

    expect(disposedBeforeReplacement).toEqual([])
    expect(fake.disposed).toEqual([MODEL_SYSTEM_SECTION, PERSONA_SECTION])
    expect(fake.active.get(PERSONA_SECTION)?.text).toBe('Second persona.')
    expect(fake.active.size).toBe(2)

    // A replaced registration is already disposed; disposing it again is a no-op.
    await first.dispose()
    expect(fake.disposed).toHaveLength(2)
    expect(fake.active.get(PERSONA_SECTION)?.text).toBe('Second persona.')

    await second.dispose()
    expect(fake.active.size).toBe(0)
  })

  it('rolls back every section it registered when one registration throws', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope({ failOn: PERSONA_SECTION })

    await expect(assembly.registerAssemblySections({ scope: fake.scope, session: session() }))
      .rejects.toThrow(`cannot register ${PERSONA_SECTION}`)

    expect(fake.active.size).toBe(0)
    expect(fake.disposed).toEqual([MODEL_SYSTEM_SECTION])
  })

  it('serialises concurrent mounts for one scope: the later call wins', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope()

    const [first, second] = await Promise.all([
      assembly.registerAssemblySections({ scope: fake.scope, session: session() }),
      assembly.registerAssemblySections({
        scope: fake.scope,
        session: session({ parameters: { route: ROUTE, persona: 'Later persona.' } }),
      }),
    ])

    expect(fake.active.get(PERSONA_SECTION)?.text).toBe('Later persona.')
    await first.dispose()
    expect(fake.active.get(PERSONA_SECTION)?.text).toBe('Later persona.')
    await second.dispose()
    expect(fake.disposed).toEqual([MODEL_SYSTEM_SECTION, PERSONA_SECTION, MODEL_SYSTEM_SECTION, PERSONA_SECTION])
  })

  it('hands the plugin context one disposer per successful mount', async () => {
    const disposers: Array<() => Promise<void>> = []
    const assembly = createAssemblyService({ onMount: (dispose) => { disposers.push(dispose) } })
    const fake = fakeScope()

    await assembly.registerAssemblySections({ scope: fake.scope, session: session() })
    expect(disposers).toHaveLength(1)

    await disposers[0]?.()
    expect(fake.active.size).toBe(0)
  })

  it('uses the override config for both planning and registration', async () => {
    const assembly = createAssemblyService({ config: { sectionOrder: [PERSONA_SECTION, MODEL_SYSTEM_SECTION] } })
    const fake = fakeScope()

    const registration = await assembly.registerAssemblySections({ scope: fake.scope, session: session() })

    expect(registration.plan.lints).toHaveLength(1)
    // Registration order follows the plan array; the host sorts by `order`.
    expect(fake.calls.map((call) => call.name)).toEqual([PERSONA_SECTION, MODEL_SYSTEM_SECTION])
    expect(fake.calls.map((call) => call.order)).toEqual([0, 1])
  })

  it('registers the plan order itself, so a partial override cannot disagree with the plan', async () => {
    const assembly = createAssemblyService({ config: { sectionOrder: ['channel:digest'] } })
    const fake = fakeScope()

    const registration = await assembly.registerAssemblySections({ scope: fake.scope, session: session() })
    const planOrders = new Map(registration.plan.sections.map((section) => [section.name, section.order]))

    expect(fake.calls.map((call) => [call.name, call.order])).toEqual([
      [MODEL_SYSTEM_SECTION, planOrders.get(MODEL_SYSTEM_SECTION)],
      [PERSONA_SECTION, planOrders.get(PERSONA_SECTION)],
    ])
    // Recommended model-before-persona relative order survives the renumbering.
    expect(planOrders.get(MODEL_SYSTEM_SECTION)).toBeLessThan(planOrders.get(PERSONA_SECTION) ?? -Infinity)
  })

  it('rejects a same-name section another plugin already registered, and rolls back', async () => {
    const assembly = createAssemblyService()
    const fake = fakeScope()
    fake.scope.systemPrompt.section({ name: PERSONA_SECTION, order: 0, text: 'deployment persona' })

    await expect(assembly.registerAssemblySections({ scope: fake.scope, session: session() }))
      .rejects.toThrow(`duplicate section in one scope: ${PERSONA_SECTION}`)

    expect(fake.disposed).toEqual([MODEL_SYSTEM_SECTION])
    expect(fake.active.get(PERSONA_SECTION)?.text).toBe('deployment persona')
  })
})
