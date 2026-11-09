/** Shared real-host fixtures for the in-process acceptance tests. */

import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'

import type { Scope } from '@deepseek-ai/dsh-scope'

const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
})

/** Register a context for awaited teardown. */
export function ownContext(ctx: Context): Context {
  contexts.add(ctx)
  return ctx
}

/** Mount the real prompt registry over the deployment persona used by the fixtures. */
export async function mountPrompt(ctx: Context, personaPrefix = 'You are the deployment persona.'): Promise<void> {
  await ctx.plugin(SystemPrompt, { personaPrefix })
}

/** Mint a scope keyed by the given object (in production that key is the Agent). */
export async function mintScope(ctx: Context, key: object, inject: readonly string[] = ['systemPrompt']): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: [...inject] }))
  return scope
}

/** The key a minted scope was addressed by. */
export function keyOf(scope: Scope): object {
  const key = scopeOf(scope.ctx)
  if (key === undefined) throw new Error('scope is not tagged')
  return key
}
