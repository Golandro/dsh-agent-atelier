/**
 * Compat entry of the bundle. `package.json`'s `main` / `exports` point here,
 * so the install surface stays frozen while the source below it layers into
 * contract / core / providers / dsh (ticket 16). Everything is re-exported from
 * the public layer entries; no implementation lives in this file.
 */
export { AGENT_PROVIDERS_SERVICE, AGENT_REGISTRY_SERVICE, ALIAS_REGISTRY_SERVICE } from './contract/index.ts'
export { createAgentRegistry, createAgentRegistryService, createAliasRegistryService, inspectAliasRegistry } from './core/index.ts'
export { BUNDLED_AGENTS_DIR, apply, optionalFileSystem } from './dsh/host/index.ts'
export type { AgentDefinition, AgentRegistry, AliasRegistry } from './contract/index.ts'
