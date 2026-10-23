/**
 * Public entry of the dsh/host layer: the host plugin entries plus the two
 * structural host reads they are built on. This is the only layer allowed to
 * know `@deepseek-ai/cordis` (type-only for now; a runtime `Service` base is
 * P2). The all-in-one `apply` is the compatibility entry; the bundle patch
 * mounts `./core`, `./providers/fs`, and the bare-name `ui-host` row (ticket
 * 12 adds the last one because the client scanner ignores subpath rows).
 */
export { apply } from './plugin.ts'
export type { AgentManagerPluginConfig } from './plugin.ts'
export { applyCore, optionalSelectionPolicy } from './core.ts'
export { applyProviders, BUNDLED_AGENTS_DIR, CUSTOM_RANK, PROJECT_AGENTS_RANK, PROJECT_DSH_RANK, USER_AGENTS_RANK, USER_DSH_RANK, BUNDLED_AGENT_RANK, inject as providerRowInject } from './providers.ts'
export { applyUiHost, handleControlRequest } from './ui-host.ts'
export type { HostWebServer } from './ui-host.ts'
export {
  CLIENT_MARKER_HEADER,
  CLIENT_MARKER_VALUE,
  CONTROL_BASE_PATH,
  CONTROL_ROUTE_PATHS,
  MAX_BODY_BYTES,
  MAX_EDITS,
  dispatchControlRequest,
} from './wire.ts'
export type { ControlDispatchInput, ControlDispatchResult } from './wire.ts'
export { optionalFileSystem } from './fs.ts'
