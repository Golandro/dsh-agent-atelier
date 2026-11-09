/**
 * Ticket 04/05 acceptance, in process: the real DSH prompt registry plus this
 * bundle's compat assembly sink. Nothing here needs a profile install or a
 * model; the host sorts, merges and disposes exactly as production does.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

import { PERSONA_PREFIX_SECTION, createAssemblyService } from '../src/agent-assembly/index.ts'
import { keyOf, mintScope, mountPrompt, ownContext } from './support/host.ts'

import type { Scope } from '@deepseek-ai/dsh-scope'
import type { AssemblyScope, AssemblySession } from '../src/contract/index.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }

function definition(body = 'You review code.') {
  return {
    agentName: 'atlas',
    name: 'Atlas',
    description: 'code reviewer',
    body,
    modelOrder: ['smart'],
    source: 'project-dsh' as const,
    origin: 'user' as const,
    providerId: 'test',
    extra: {},
    path: '/fixtures/atlas/atlas.agent.md',
  }
}

function session(overrides: Partial<AssemblySession> = {}): AssemblySession {
  const agent = overrides.agent ?? definition()
  return {
    agent,
    parameters: overrides.parameters ?? { route: ROUTE, persona: agent.body },
    model: overrides.model ?? {
      modelName: 'chat',
      provider: 'deepseek',
      model: 'deepseek-chat',
      sysPrompt: 'Provider {{provider}} runs {{model}}.',
      available: true,
      source: 'user-dsh' as const,
    },
    ...overrides,
  }
}

interface Mounted {
  readonly ctx: Context
  readonly scope: Scope
}

async function mount(): Promise<Mounted> {
  const ctx = ownContext(new Context())
  await mountPrompt(ctx)
  const scope = await mintScope(ctx, { name: 'child' })
  return { ctx, scope }
}

async function assemble(ctx: Context, scope: Scope): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble({ scope: keyOf(scope) }))
}

describe('real prompt registry + assembly sink', () => {
  it('shadows the deployment persona and puts the model row before it', async () => {
    const { ctx, scope } = await mount()
    const assembly = createAssemblyService()
    await assembly.registerAssemblySections({ scope: scope.ctx as unknown as AssemblyScope, session: session() })

    const scoped = await ctx.systemPrompt.assemble({ scope: keyOf(scope) })
    expect(scoped.sections.map((section) => section.name)).toContain('atelier:model-sys')
    expect(scoped.sections.map((section) => section.name)).toContain(PERSONA_PREFIX_SECTION)

    const text = await assemble(ctx, scope)
    expect(text).toContain('You review code.')
    expect(text).not.toContain('You are the deployment persona.')
    expect(text.indexOf('Provider deepseek')).toBeLessThan(text.indexOf('You review code.'))

    const globalText = renderPrompt(await ctx.systemPrompt.assemble())
    expect(globalText).toContain('You are the deployment persona.')
    expect(globalText).not.toContain('You review code.')
  })

  it('keeps an empty persona registered, so the deployment prefix is shadowed', async () => {
    const { ctx, scope } = await mount()
    const empty: AssemblySession = { agent: definition(''), parameters: { route: ROUTE, persona: '' } }
    await createAssemblyService().registerAssemblySections({ scope: scope.ctx as unknown as AssemblyScope, session: empty })

    expect(await assemble(ctx, scope)).not.toContain('You are the deployment persona.')
    const scoped = await ctx.systemPrompt.assemble({ scope: keyOf(scope) })
    expect(scoped.sections.some((section) => section.name === PERSONA_PREFIX_SECTION)).toBe(true)
  })

  it('lifts the scoped sections on dispose and restores them on a remount', async () => {
    const { ctx, scope } = await mount()
    const assembly = createAssemblyService()
    const first = await assembly.registerAssemblySections({ scope: scope.ctx as unknown as AssemblyScope, session: session() })

    await first.dispose()
    const afterDispose = await assemble(ctx, scope)
    expect(afterDispose).toContain('You are the deployment persona.')
    expect(afterDispose).not.toContain('You review code.')

    await assembly.registerAssemblySections({ scope: scope.ctx as unknown as AssemblyScope, session: session() })
    const afterRemount = await assemble(ctx, scope)
    expect(afterRemount).toContain('You review code.')
    expect(afterRemount).not.toContain('You are the deployment persona.')
  })
})
