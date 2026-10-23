/**
 * Public entry of the control layer (ticket 11): the six-member control core,
 * the document port ticket 12 binds components to, the edits-in client port
 * both of ticket 12's adapters implement, and the one list-query evaluator.
 * The pure seams (`compose`, `planDocumentEdits`, the registry splice) and the
 * in-memory test adapter stay internal — tests import their modules directly.
 */
export { createAgentDocPort, createControlCore, planDirtyEdits } from './core.ts'
export type { AgentDocPort, ControlCore, ControlDependencies } from './core.ts'
export { ChainExhaustedError } from './session-agent.ts'
export { projectItemEffort, routeNotAllowed, sessionChainContext } from './resolve.ts'
export type {
  EffortCapabilities,
  ItemEffortOverrides,
  SelectionPolicy,
  SessionChainContext,
  SessionResolutionRequest,
} from './resolve.ts'
export type { ComposeSessionOptions, ComposedAgentSession, SessionStartParameters } from './session.ts'
export { createMemoryControlClient } from './client.ts'
export type { ControlClient, ControlClientOptions } from './client.ts'
export { createHttpControlClient } from './http-client.ts'
export type { HttpControlClientOptions } from './http-client.ts'
export {
  abortError,
  CLIENT_MARKER_HEADER,
  CLIENT_MARKER_VALUE,
  codeForReport,
  ControlClientError,
  errorMessage,
  isAbortError,
  statusForWriteReport,
  throwIfAborted,
  UnknownAgentError,
} from './client-errors.ts'
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
