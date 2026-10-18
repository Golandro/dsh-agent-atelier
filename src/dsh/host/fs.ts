/**
 * The host filesystem service, when this context has one.
 *
 * Mirrors `optionalFileSystem(ctx)`; a context without an `fs` service (unit
 * tests, minimal hosts) gets `undefined` and discovery falls back to Node.
 */
import type { Context } from '@deepseek-ai/cordis'

import { createHostFileSystem, isHostFileSystem } from '../../providers/fs/index.ts'

import type { AgentFileSystem } from '../../core/ports.ts'

export function optionalFileSystem(ctx: Context): AgentFileSystem | undefined {
  const candidate: unknown = ctx.get('fs')
  return isHostFileSystem(candidate) ? createHostFileSystem(candidate) : undefined
}
