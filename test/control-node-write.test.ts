import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createNodeControlFileSystem } from '../src/providers/fs/write.ts'

/** One throwaway directory per run; tests never share state. */
const root = mkdtempSync(join(tmpdir(), 'dsh-control-write-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('node control file system', () => {
  it('writes a new file exclusively with the requested mode', async () => {
    const fs = createNodeControlFileSystem()
    const directory = join(root, 'nested', 'dir')
    await fs.ensureDirectory(directory)
    const tempPath = await fs.writeNewFile(directory, 'hello\n', 0o600)

    expect(statSync(tempPath).mode & 0o777).toBe(0o600)
    await fs.renameFile(tempPath, join(directory, 'final.agent.md'))
    expect(await fs.readTextFile(join(directory, 'final.agent.md'))).toBe('hello\n')
  })

  it('treats a missing path as absence, not an error', async () => {
    const fs = createNodeControlFileSystem()
    expect(await fs.readTextFile(join(root, 'absent.md'))).toBeUndefined()
    // Reading a directory is absence too (EISDIR maps like ENOENT).
    const directory = join(root, 'a-directory')
    await fs.ensureDirectory(directory)
    expect(await fs.readTextFile(directory)).toBeUndefined()
  })

  it('removes a file without failing on an absent one', async () => {
    const fs = createNodeControlFileSystem()
    const path = join(root, 'gone.md')
    writeFileSync(path, 'bye')
    await fs.removeFile(path)
    await fs.removeFile(path)
    expect(await fs.readTextFile(path)).toBeUndefined()
  })
})
