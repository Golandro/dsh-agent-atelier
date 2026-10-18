/** Node-backed port, used when the host has no `fs` service. */
import { access, readFile, readdir } from 'node:fs/promises'

import { absentAs, dirEntry, dirKind } from './absence.ts'

import type { AgentFileSystem } from '../../core/ports.ts'

export function createNodeFileSystem(): AgentFileSystem {
  return {
    listDirectory: (path, signal) => absentAs(async () => {
      const entries = await readdir(path, { withFileTypes: true })
      signal?.throwIfAborted()
      return entries.map((entry) => dirEntry(entry.name, dirKind(entry)))
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
