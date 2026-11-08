/**
 * Public entry of the agent-assembly layer: ticket 04's pure planner and
 * compat-mode runtime sink, plus ticket 06's catalog projection, digest gate,
 * durable source and renderer. The host rows are the only consumers inside
 * this bundle; everything here reads the contract layer only and never the
 * host, the filesystem or a hash implementation.
 */
export {
  DIGEST_CHANNEL_SECTION,
  FIRST_MESSAGE_CHANNEL_SECTION,
  MODEL_SYSTEM_SECTION,
  PERSONA_PREFIX_SECTION,
  PRE_STEP_CHANNEL_SECTION,
  SKILLS_SECTION,
  TOOLS_CHANNEL_SECTION,
  planAssembly,
} from './planner.ts'
export { createAssemblyService } from './sink.ts'
export type { AssemblyServiceOptions } from './sink.ts'
export {
  CATALOG_DESCRIPTION_MAX_LENGTH,
  CATALOG_SOURCE_KIND,
  catalogCanonicalText,
  catalogDigest,
  catalogSourcePayload,
  createCatalogMessage,
  digestCatalogSource,
  planCatalogPublish,
  projectCatalog,
  readCatalogSource,
  renderCatalog,
} from './catalog.ts'
export type {
  CatalogAgentEntry,
  CatalogAgentInput,
  CatalogAliasEntry,
  CatalogEntry,
  CatalogGateInput,
  CatalogHash,
  CatalogMessage,
  CatalogProjectionInput,
  CatalogPublishPlan,
  CatalogRenderOptions,
  CatalogSnapshot,
  CatalogSource,
  CatalogTextBlock,
} from './catalog.ts'
