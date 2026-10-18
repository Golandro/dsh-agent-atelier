/**
 * Absence handling shared by the Node and host filesystem adapters: a missing
 * path is reported as `undefined` instead of an error, so a root that does not
 * exist yet is simply empty (the native read path's behaviour).
 */
import type { AgentDirEntry } from '../../core/ports.ts'

/** Run one read, reporting a missing path as absence instead of an error. */
export async function absentAs<T>(read: () => Promise<T>, alsoAbsentCode?: string): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    if (isAbsentPathError(error) || (alsoAbsentCode !== undefined && hasErrorCode(error, alsoAbsentCode))) return undefined
    throw error
  }
}

export function dirEntry(name: string, kind: AgentDirEntry['kind']): AgentDirEntry {
  return { name, kind }
}

/** Map a dirent (or its plain `type` string) onto the port's directory-entry kind. */
export function dirKind(source: string | { isDirectory(): boolean; isFile(): boolean }): AgentDirEntry['kind'] {
  const type = typeof source === 'string' ? source : source.isDirectory() ? 'directory' : source.isFile() ? 'file' : 'other'
  return type === 'directory' ? 'directory' : type === 'file' ? 'file' : 'other'
}

/** Codes that mean "this path is not there", across Node and the host `fs` service. */
function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT')
    || hasErrorCode(error, 'ENOTDIR')
    || hasErrorCode(error, 'EISDIR')
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
