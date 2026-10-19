/**
 * The Node write adapter (ticket 11): the `ControlFileSystem` port over
 * `node:fs/promises`. Temp-name uniqueness is the adapter's business — a UUID
 * name inside the target directory — so the core's commit algorithm runs
 * unchanged against Node and against the in-memory test adapter. Writes are
 * exclusive (`wx`) and carry the caller's mode (`0600`), and rename replaces
 * the target, which is what makes the temp-then-rename sequence atomic.
 *
 * Reads keep the read port's discipline: a missing path is absence
 * (`undefined`), not an error, while a failure that is not about absence
 * propagates so the commit path can report it as `io-error`.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { absentAs } from './absence.ts'

import type { ControlFileSystem } from '../../core/ports.ts'

export function createNodeControlFileSystem(): ControlFileSystem {
  return {
    readTextFile: (path) => absentAs(() => readFile(path, { encoding: 'utf8' })),
    ensureDirectory: async (path) => {
      await mkdir(path, { recursive: true })
    },
    writeNewFile: async (directory, text, mode) => {
      const tempPath = join(directory, `.commit-${randomUUID()}`)
      await writeFile(tempPath, text, { flag: 'wx', mode })
      return tempPath
    },
    renameFile: async (from, to) => {
      await rename(from, to)
    },
    removeFile: async (path) => {
      await rm(path, { force: true })
    },
  }
}
