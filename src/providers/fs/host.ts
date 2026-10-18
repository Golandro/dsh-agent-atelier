/** Host-`fs`-backed port, mirroring the native read path's absence handling. */
import { absentAs, dirEntry, dirKind } from './absence.ts'

import type { AgentFileSystem } from '../../core/ports.ts'

/** The slice of the host `fs` service this port uses. */
export interface HostFileSystem {
  resolve(path: string): Promise<unknown>
  listDir(target: unknown, signal?: AbortSignal): Promise<readonly HostDirEntry[]>
  stat(target: unknown, signal?: AbortSignal): Promise<HostStat | undefined>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
}

interface HostDirEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
}

interface HostStat {
  readonly type: 'file' | 'directory' | 'other'
}

export function createHostFileSystem(fs: HostFileSystem): AgentFileSystem {
  return {
    listDirectory: (path, signal) => absentAs(async () => {
      const target = await fs.resolve(path)
      return (await fs.listDir(target, signal)).map((entry) => dirEntry(entry.name, dirKind(entry.type)))
    }),
    readTextFile: (path, signal) => absentAs(async () => {
      const target = await fs.resolve(path)
      const info = await fs.stat(target, signal)
      if (info === undefined || info.type !== 'file') return undefined
      return await fs.readText(target, signal)
    }, 'FS_NOT_TEXT'),
    pathExists: async (path) => {
      try {
        const target = await fs.resolve(path)
        return (await fs.stat(target)) !== undefined
      } catch {
        // A backend may reject or hide this candidate; the walk simply continues.
        return false
      }
    },
  }
}

export function isHostFileSystem(value: unknown): value is HostFileSystem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['resolve'] === 'function'
    && typeof candidate['listDir'] === 'function'
    && typeof candidate['stat'] === 'function'
    && typeof candidate['readText'] === 'function'
}
