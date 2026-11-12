/**
 * Public entry of the resolve domain: the pure model-chain resolution engine and
 * the failure-ledger projection it reads. Both modules take injected plain data
 * and never touch a file, the environment or the host context.
 */
export { resolveModelChain, routeKeyOf } from './model-chain.ts'
export type { ChainItemEffort, ChainResolutionContext, SupportedEfforts } from './model-chain.ts'
export { DEGRADED_FAILURES, RATE_LIMIT_STREAK, RATE_LIMIT_WINDOW_MS, routeKey, withAvailability } from './observations.ts'
export type { ProjectedModel } from './observations.ts'
