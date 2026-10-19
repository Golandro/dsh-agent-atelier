/**
 * Public entry of the filesystem adapters. The read adapters build the same
 * `AgentFileSystem` port and the write adapter the `ControlFileSystem` port
 * (both in `src/core/ports.ts`); which one a caller uses is the layer's
 * business — the host-context read lives in `src/dsh/host/`.
 */
export { createNodeFileSystem } from './node.ts'
export { createHostFileSystem, isHostFileSystem } from './host.ts'
export { createFileSystemAgentProvider, type FileSystemAgentProviderOptions } from './source.ts'
export { createNodeControlFileSystem } from './write.ts'
