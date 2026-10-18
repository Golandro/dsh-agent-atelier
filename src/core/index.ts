/**
 * Public entry of the core layer: the port types discovery reads through and
 * the factory functions behind the two registries plus the provider registry.
 * Deep modules stay internal (`catalog/`); consumers go through this entry or
 * the port subentry.
 */
export type { AgentDirEntry, AgentFileSystem } from './ports.ts'
export { createAgentRegistry } from './catalog/registry.ts'
export { createAgentRegistryService } from './catalog/discovery.ts'
export { createAliasRegistryService, inspectAliasRegistry } from './catalog/alias-registry.ts'
export { createAgentProviders } from './providers-registry.ts'
export { resolveAgentsHome, resolveDshHome } from './catalog/roots.ts'
