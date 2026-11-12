/**
 * Public entry of the providers domain: the membership registry behind
 * `ctx.agentProviders`. The filesystem provider keeps its own entry
 * (`src/providers/fs/index.ts`), so the two adapters stay separable.
 */
export { createAgentProviders } from './registry.ts'
