/**
 * Public entry of the contract layer: the frozen cross-layer types (ticket 01's
 * 契约（冻结）) plus the service key constants. Nothing here may import beyond
 * this directory — the contract is the layer every other layer reads from.
 */
export * from './types.ts'
export * from './service-keys.ts'
