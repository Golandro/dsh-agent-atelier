/**
 * Public entry of the assembly layer: ticket 04's pure planner and
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
export { createPromptLedger } from './ledger.ts'
export type { PromptLedger } from './ledger.ts'
export { PROMPT_SOURCE_ORDER, buildPromptSegments, emptyPromptSegments, promptSegmentParts, promptShadowLabel } from './segments.ts'
export type {
  AssembledContext,
  AssembledSection,
  HostPromptAssembly,
  PromptSectionLedgerEntry,
  ToolDeclaration,
} from './segments.ts'
// The view DTOs are defined in the contract layer (their consumers span the host
// read face and the browser chunk); the assembly barrel re-exports them so a
// reader of this layer still finds the projection's output shape here. One
// definition, two entrances — not a second copy.
export type {
  PromptPart,
  PromptSegment,
  PromptSegmentBase,
  PromptSegmentDiagnostic,
  PromptSegmentDiagnosticCode,
  PromptSegmentParts,
  PromptSegmentSurface,
  PromptSegmentsView,
  PromptShadow,
  PromptSourceGroup,
  PromptSourceId,
  UnattributedPromptSegment,
} from '../contract/index.ts'
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