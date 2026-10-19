import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFileSystemAgentProvider } from '../src/providers/fs/source.ts'
import { createNodeFileSystem } from '../src/providers/fs/node.ts'
import type { AgentFileSystem } from '../src/core/ports.ts'

let tmp = ''

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-atelier-source-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** Build the provider under test: one root, one filesystem selector. */
function provider(
  resolveRoot: (projectRoot: string | undefined) => string | undefined,
  selectFileSystem: () => AgentFileSystem = () => createNodeFileSystem(),
) {
  return createFileSystemAgentProvider({
    id: 'project-dsh',
    source: 'project-dsh',
    rank: 100,
    trust: 'untrusted',
    origin: 'user',
    resolveRoot,
    selectFileSystem,
  })
}

/** An in-memory port: direct children derived from a flat file/dir layout. */
function memoryFileSystem(files: Record<string, string>, dirs: readonly string[] = []): AgentFileSystem {
  const documents = new Map(Object.entries(files))
  const directories = new Set(dirs)
  return {
    async listDirectory(path) {
      const prefix = path === '/' ? '/' : `${path}/`
      const names = new Set<string>()
      for (const file of documents.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0] ?? '')
      }
      for (const directory of directories) {
        if (directory.startsWith(prefix)) names.add(directory.slice(prefix.length).split('/')[0] ?? '')
      }
      return [...names].map((name) => ({ name, kind: directories.has(join(path, name)) ? ('directory' as const) : ('file' as const) }))
    },
    async readTextFile(path) {
      return documents.get(path)
    },
    async pathExists(path) {
      return documents.has(path) || directories.has(path)
    },
  }
}

describe('file system agent source provider', () => {
  it('lists raw direct children without filtering', async () => {
    const root = join(tmp, 'agents')
    write(join(root, 'tidy', 'tidy.agent.md'), 'body\n')
    write(join(root, 'Bad_Name', 'Bad_Name.agent.md'), 'body\n')
    write(join(root, '.hidden', '.hidden.agent.md'), 'body\n')
    write(join(root, 'flat.md'), 'body\n')
    write(join(root, 'README.md'), 'not an agent\n')
    write(join(root, 'registry.yaml'), 'models: {}\n')

    const entries = await provider(() => root).listEntries({})

    expect(entries?.map((entry) => entry.name).sort()).toEqual([
      '.hidden',
      'Bad_Name',
      'README.md',
      'flat.md',
      'registry.yaml',
      'tidy',
    ])
    const tidy = entries?.find((entry) => entry.name === 'tidy')
    expect(tidy).toEqual({ name: 'tidy', kind: 'directory', path: join(root, 'tidy'), providerId: 'project-dsh' })
    expect(entries?.find((entry) => entry.name === 'flat.md')?.kind).toBe('file')
  })

  it('derives its root from the project root the query passes', async () => {
    const root = join(tmp, 'project', '.dsh', 'agents')
    write(join(root, 'alpha', 'alpha.agent.md'), 'body\n')

    const entries = await provider((projectRoot) => (projectRoot === undefined ? undefined : join(projectRoot, '.dsh', 'agents')))
      .listEntries({ projectRoot: join(tmp, 'project') })

    expect(entries?.map((entry) => entry.path)).toEqual([join(root, 'alpha')])
  })

  it('skips the query when the resolved root is undefined', async () => {
    const providerUnderTest = provider((projectRoot) => (projectRoot === undefined ? undefined : join(projectRoot, '.dsh', 'agents')))

    await expect(providerUnderTest.listEntries({})).resolves.toBeUndefined()
  })

  it('returns undefined when the root is absent', async () => {
    await expect(provider(() => join(tmp, 'missing')) .listEntries({})).resolves.toBeUndefined()
  })

  it('reads the standard document raw, without parsing frontmatter', async () => {
    const root = join(tmp, 'agents')
    const raw = '---\nname: Raw\nmodelOrder: [fast]\n---\nbody text\n'
    write(join(root, 'tidy', 'tidy.agent.md'), raw)

    const entries = await provider(() => root).listEntries({})
    const read = await provider(() => root).readDocument(entries![0]!, {})

    expect(read).toEqual({ kind: 'text', document: { path: join(root, 'tidy', 'tidy.agent.md'), text: raw } })
  })

  it('reports a missing document with its precise path', async () => {
    const root = join(tmp, 'agents')
    mkdirSync(join(root, 'ghost'), { recursive: true })

    const entries = await provider(() => root).listEntries({})
    const read = await provider(() => root).readDocument(entries![0]!, {})

    expect(read).toEqual({ kind: 'missing', path: join(root, 'ghost', 'ghost.agent.md'), reason: 'absent' })
  })

  it('reads through the filesystem the selector returns at use time', async () => {
    const root = join(tmp, 'whatever')
    const first = memoryFileSystem({ [join(root, 'alpha', 'alpha.agent.md')]: 'first body\n' }, [join(root, 'alpha')])
    const second = memoryFileSystem({ [join(root, 'beta', 'beta.agent.md')]: 'second body\n' }, [join(root, 'beta')])
    let current = first
    const providerUnderTest = provider(() => root, () => current)

    // The selector is consulted per call, so swapping the backing port between
    // queries changes what the provider sees (the host `fs` read pattern).
    await expect(providerUnderTest.listEntries({})).resolves.toEqual([
      { name: 'alpha', kind: 'directory', path: join(root, 'alpha'), providerId: 'project-dsh' },
    ])
    const entries = await providerUnderTest.listEntries({})
    await expect(providerUnderTest.readDocument(entries![0]!, {})).resolves.toEqual({
      kind: 'text',
      document: { path: join(root, 'alpha', 'alpha.agent.md'), text: 'first body\n' },
    })

    current = second
    await expect(providerUnderTest.listEntries({})).resolves.toEqual([
      { name: 'beta', kind: 'directory', path: join(root, 'beta'), providerId: 'project-dsh' },
    ])
  })
})
