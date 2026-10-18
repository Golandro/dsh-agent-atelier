/**
 * Absence handling shared by the Node and host filesystem adapters: a missing
 * path is reported as `undefined` instead of an error, so a root that does not
 * exist yet is simply empty (the native read path's behaviour).
 */
import type { AgentDirEntry } from '../../core/ports.ts'

/** Run one read, reporting a missing path as absence instead of an error. */
export async function absentAs<T>(read: () => Promise<T>, alsoAbsent?: string): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    if (isAbsentPathError(error) || (alsoAbsent !== undefined && hasErrorCode(error, alsoAbsent))) return undefined
    throw error
  }
}

export function dirEntry(name: string, kind: AgentDirEntry['kind']): AgentDirEntry {
  return { name, kind }
}

export function dirKind(type: string): AgentDirEntry['kind'] {
  return type === 'directory' ? 'directory' : type === 'file' ? 'file' : 'other'
}

/** Codes that mean "this path is not there", across Node and the host `fs` service. */
export function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT')
    || hasErrorCode(error, 'ENOTDIR')
    || hasErrorCode(error, 'EISDIR')
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
