/**
 * Public entry of the core layer: the port types discovery reads through and
 * the factory functions behind the two registries plus the provider registry.
 * Deep modules stay internal (`catalog/`); consumers go through this entry or
 * the port subentry. The document and registry readers are also exported so
 * the write side (ticket 11, `src/control/`) reuses them instead of forking a
 * second YAML implementation.
 */
export type { AgentDirEntry, AgentFileSystem } from './ports.ts'
export { createAgentRegistry } from './catalog/registry.ts'
export { createAgentRegistryService } from './catalog/discovery.ts'
export { parseAgentDocument, splitAgentFence } from './catalog/frontmatter.ts'
export type { SplitAgentFence } from './catalog/frontmatter.ts'
export { DEFAULT_ALIAS_NAME, readRegistryLayer } from './catalog/registry-file.ts'
export { aliasRegistryLayers, createAliasRegistryService, inspectAliasRegistry } from './catalog/alias-registry.ts'
export type { AliasLayer } from './catalog/alias-registry.ts'
export { createAgentProviders } from './providers-registry.ts'
export { resolveAgentsHome, resolveDshHome } from './catalog/roots.ts'
