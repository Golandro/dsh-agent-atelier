/**
 * Public entry of the catalog domain: discovery, the two registries, the
 * document and registry readers, the roots, and the filesystem ports they read
 * through. Deep modules stay internal; other layers read this entry or the
 * narrower `./ports.ts` sub-entry (`src/catalog/ports.ts`) and never a deep
 * file. The readers are also exported so the write side (ticket 11,
 * `src/control/`) reuses them instead of forking a second YAML implementation.
 */
export type { AgentDirEntry, AgentFileSystem } from './ports.ts'
export { createAgentRegistry } from './registry.ts'
export { createAgentRegistryService } from './discovery.ts'
export { parseAgentDocument, splitAgentFence } from './frontmatter.ts'
export type { SplitAgentFence } from './frontmatter.ts'
export { DEFAULT_ALIAS_NAME, readRegistryLayer } from './registry-file.ts'
export { aliasRegistryLayers, createAliasRegistryService, inspectAliasRegistry } from './alias-registry.ts'
export type { AliasLayer } from './alias-registry.ts'
export { findProjectRoot, resolveAgentsHome, resolveDshHome } from './roots.ts'
