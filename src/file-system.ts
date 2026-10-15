/**
 * The filesystem port discovery reads through.
 *
 * Discovery mirrors the native skill loader's `optionalFileSystem(ctx)`
 * (`skill/skill-filesystem/src/index.ts:849`): when the host context exposes an
 * `fs` service, reads and listings go through it (so a sandboxed or remote
 * workspace is honoured); otherwise they fall back to Node's filesystem. The
 * bundled root is the exception — it is our own trusted asset, so it is read
 * through Node directly, exactly as the native loader bypasses the `fs` service
 * for `trustedHost` roots.
 *
 * The port is deliberately tiny: the discovery layer only ever lists a root,
 * reads one document, or asks whether a `.git` marker exists. Paths stay host
 * paths throughout, so no opaque target type has to leak into this bundle.
 */
import { access, readFile, readdir } from 'node:fs/promises'

import type { Context } from '@deepseek-ai/cordis'

/** One direct child of a listed root. */
export interface AgentDirEntry {
  readonly name: string
  readonly kind: 'file' | 'directory' | 'other'
}

/**
 * Everything discovery needs from a filesystem.
 *
 * Absence is not an error: each method reports it as `undefined`/`false` so a
 * root that does not exist yet is simply empty.
 */
export interface AgentFileSystem {
  /** Direct children of `path`, or `undefined` when `path` is not a directory. */
  listDirectory(path: string, signal?: AbortSignal): Promise<readonly AgentDirEntry[] | undefined>
  /** UTF-8 contents of a regular file, or `undefined` when it is absent or not a file. */
  readTextFile(path: string, signal?: AbortSignal): Promise<string | undefined>
  /** Whether `path` exists at all (file or directory). */
  pathExists(path: string, signal?: AbortSignal): Promise<boolean>
}

/** The slice of the host `fs` service this port uses. */
interface HostFileSystem {
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

/** Node-backed port, used when the host has no `fs` service. */
export function createNodeFileSystem(): AgentFileSystem {
  return {
    listDirectory: (path, signal) => absentAs(async () => {
      const entries = await readdir(path, { withFileTypes: true })
      signal?.throwIfAborted()
      return entries.map((entry) => dirEntry(entry.name, entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'))
    }),
    readTextFile: (path, signal) => absentAs(() => readFile(
      path,
      typeof signal === 'undefined' ? { encoding: 'utf8' } : { encoding: 'utf8', signal },
    )),
    pathExists: async (path) => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
  }
}

/** Host-`fs`-backed port, mirroring the native read path's absence handling. */
function createHostFileSystem(fs: HostFileSystem): AgentFileSystem {
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

/**
 * The host filesystem service, when this context has one.
 *
 * Mirrors `optionalFileSystem(ctx)`; a context without an `fs` service (unit
 * tests, minimal hosts) gets `undefined` and discovery falls back to Node.
 */
export function optionalFileSystem(ctx: Context): AgentFileSystem | undefined {
  const candidate: unknown = ctx.get('fs')
  return isHostFileSystem(candidate) ? createHostFileSystem(candidate) : undefined
}

/** Run one read, reporting a missing path as absence instead of an error. */
async function absentAs<T>(read: () => Promise<T>, alsoAbsent?: string): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    if (isAbsentPathError(error) || (alsoAbsent !== undefined && hasErrorCode(error, alsoAbsent))) return undefined
    throw error
  }
}

function dirEntry(name: string, kind: AgentDirEntry['kind']): AgentDirEntry {
  return { name, kind }
}

function dirKind(type: string): AgentDirEntry['kind'] {
  return type === 'directory' ? 'directory' : type === 'file' ? 'file' : 'other'
}

function isHostFileSystem(value: unknown): value is HostFileSystem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['resolve'] === 'function'
    && typeof candidate['listDir'] === 'function'
    && typeof candidate['stat'] === 'function'
    && typeof candidate['readText'] === 'function'
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
