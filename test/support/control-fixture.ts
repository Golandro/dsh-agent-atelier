/**
 * The shared in-memory control fixture (簇 H): one project layer holding a
 * fenced agent document and a one-model registry, parameterised by the roots a
 * test needs. The standard texts live here, so the control-client and
 * host-wiring suites cannot drift from each other; suites that need a different
 * document or extra layers (the control core's user layer) pass them in.
 */

import { createInMemoryControlCore } from '../../src/control/memory.ts'

import type { InMemoryControlCore, InMemoryControlOptions } from '../../src/control/memory.ts'

/** The default document: one fenced agent named alpha. */
export const STANDARD_DOC_TEXT = '---\nname: Alpha\ndescription: first\n---\nAlpha body\n'

/** The default registry: one real model behind no alias. */
export const STANDARD_REGISTRY_TEXT = 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\n'

/** Where the fixture's standard files sit. */
export interface ControlFixturePaths {
  readonly projectRoot: string
  readonly dshHome: string
  /** `<projectRoot>/.dsh/agents`. */
  readonly agentsDir: string
  /** The fenced document at `<agentsDir>/alpha/alpha.agent.md`. */
  readonly docPath: string
  /** The project registry at `<agentsDir>/registry.yaml`. */
  readonly registryPath: string
}

export interface ControlFixtureOptions {
  /** The workspace the project layer hangs off; also the scan's default cwd. */
  readonly projectRoot: string
  /** The harness home holding the user layer. */
  readonly dshHome: string
  /** Document text; defaults to {@link STANDARD_DOC_TEXT}. */
  readonly docText?: string | undefined
  /** Registry text; defaults to {@link STANDARD_REGISTRY_TEXT}. */
  readonly registryText?: string | undefined
  /** Extra files layered over the standard `.git` + document + registry. */
  readonly extraFiles?: Readonly<Record<string, string>> | undefined
}

export interface ControlFixture extends ControlFixturePaths {
  readonly docText: string
  readonly registryText: string
  /** The seeded file map: `.git`, the document, the registry, and any extras. */
  readonly files: Readonly<Record<string, string>>
  /** A fresh core over the seeded files; a `files` override replaces the map, as before. */
  readonly createCore: (overrides?: InMemoryControlOptions | undefined) => InMemoryControlCore
}

/**
 * Build one fixture. Paths derive from the two roots, so a suite only names its
 * prefix; the document and registry texts stay single-sourced here unless the
 * suite passes its own.
 */
export function createControlFixture(options: ControlFixtureOptions): ControlFixture {
  const { projectRoot, dshHome } = options
  const agentsDir = `${projectRoot}/.dsh/agents`
  const docPath = `${agentsDir}/alpha/alpha.agent.md`
  const registryPath = `${agentsDir}/registry.yaml`
  const docText = options.docText ?? STANDARD_DOC_TEXT
  const registryText = options.registryText ?? STANDARD_REGISTRY_TEXT
  const files: Record<string, string> = {
    [`${projectRoot}/.git`]: '',
    [docPath]: docText,
    [registryPath]: registryText,
    ...(options.extraFiles ?? {}),
  }
  const createCore = (overrides: InMemoryControlOptions = {}): InMemoryControlCore =>
    createInMemoryControlCore({ projectRoot, dshHome, files, ...overrides })

  return { projectRoot, dshHome, agentsDir, docPath, registryPath, docText, registryText, files, createCore }
}
