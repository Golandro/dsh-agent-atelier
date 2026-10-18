/**
 * Public entry of the dsh/host layer: the host plugin entries plus the two
 * structural host reads they are built on. This is the only layer allowed to
 * know `@deepseek-ai/cordis` (type-only for now; a runtime `Service` base is
 * P2). The all-in-one `apply` is the compatibility entry; the bundle patch
 * mounts `./core` and `./providers/fs` as two rows (ticket 18).
 */
export { apply } from './plugin.ts'
export { applyCore } from './core.ts'
export { applyProviders, BUNDLED_AGENTS_DIR, CUSTOM_RANK, PROJECT_AGENTS_RANK, PROJECT_DSH_RANK, USER_AGENTS_RANK, USER_DSH_RANK, BUNDLED_AGENT_RANK, inject as providerRowInject } from './providers.ts'
export { optionalFileSystem } from './fs.ts'
