/**
 * Public entry of the control layer (ticket 11): the six-member control core,
 * the document port ticket 12 binds components to, and the one list-query
 * evaluator. The pure seams (`compose`, `planDocumentEdits`, the registry
 * splice) and the in-memory test adapter stay internal — tests import their
 * modules directly.
 */
export { createAgentDocPort, createControlCore } from './core.ts'
export type { AgentDocPort, ControlCore, ControlDependencies } from './core.ts'
export { evaluateAgentQuery } from './query.ts'
export type {
  AgentListQuery,
  AgentRow,
  BlockId,
  ComposedAgentDocument,
  ComposedBlock,
  ControlFinding,
  ControlSnapshot,
  DocumentEdit,
  DocumentFraming,
  FrontmatterField,
  FrontmatterFieldValue,
  RegistryEdit,
  WriteFailureCode,
  WritePlan,
  WritePlanEntry,
  WriteRejection,
  WriteRejectionCode,
  WriteReport,
  WriteResult,
} from './types.ts'
