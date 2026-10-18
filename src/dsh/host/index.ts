/**
 * Public entry of the dsh/host layer: the host plugin entry plus the two
 * structural host reads it is built on. This is the only layer allowed to know
 * `@deepseek-ai/cordis` (type-only for now; a runtime `Service` base is P2).
 */
export { BUNDLED_AGENTS_DIR, apply } from './plugin.ts'
export { optionalFileSystem } from './fs.ts'
