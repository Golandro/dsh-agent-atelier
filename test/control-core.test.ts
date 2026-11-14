import { describe, expect, it } from 'vitest'

import { evaluateAgentQuery } from '../src/control/index.ts'
import { createAgentDocPort } from '../src/control/core.ts'
import { createControlFixture } from './support/control-fixture.ts'

import type { AgentDefinition, AgentSource } from '../src/contract/index.ts'
import type { AgentListQuery, AgentRow, DocumentEdit } from '../src/control/index.ts'
import type { InMemoryControlCore } from '../src/control/memory.ts'

const PROJECT_ROOT = '/dsh-proj'
const DSH_HOME = '/dsh-home'
const HOME_AGENTS = `${DSH_HOME}/agents`
const DOC_BETA = `${HOME_AGENTS}/beta/beta.agent.md`
const REGISTRY_USER = `${HOME_AGENTS}/registry.yaml`

const ALPHA_TEXT = '---\nname: Alpha\n# kept comment\nunknown-key: 1\ndescription: first\n---\nAlpha body\n'
const BETA_TEXT = 'plain beta body\n'
const REGISTRY_PROJECT_TEXT = 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\naliases:\n  smart: [gpt5]\n'
const REGISTRY_USER_TEXT = 'models:\n  kimi:\n    provider: moonshot\n    model: kimi-2\n    available: false\n'

/**
 * The two-layer fixture: the shared project layer (one fenced alpha document
 * plus the project registry) and the user layer the merge tests need.
 */
const fixture = createControlFixture({
  projectRoot: PROJECT_ROOT,
  dshHome: DSH_HOME,
  docText: ALPHA_TEXT,
  registryText: REGISTRY_PROJECT_TEXT,
  extraFiles: {
    [DOC_BETA]: BETA_TEXT,
    [REGISTRY_USER]: REGISTRY_USER_TEXT,
  },
})
const {
  projectRoot: PROJECT,
  agentsDir: PROJECT_AGENTS,
  docPath: DOC_ALPHA,
  registryPath: REGISTRY_PROJECT,
  createCore,
} = fixture

/**
 * The project registry after an `addModel` of `sonnet`. It is both the expected
 * output of the addModel case and the seed the addAlias/deleteModel cases start
 * from, so the three cases share one worked example instead of three copies.
 */
const TWO_MODEL_REGISTRY = 'models:\n'
  + '  gpt5:\n'
  + '    provider: openai\n'
  + '    model: gpt-5\n'
  + '  sonnet:\n'
  + '    provider: anthropic\n'
  + '    model: claude-sonnet\n'
  + '    sysPrompt: Be terse.\n'
  + '    available: false\n'
  + 'aliases:\n'
  + '  smart: [gpt5]\n'

/** A core whose project registry starts from `registryText` instead of the fixture default. */
function seededCore(registryText: string): InMemoryControlCore {
  const core = createCore()
  core.files.set(REGISTRY_PROJECT, registryText)
  return core
}

/** A list row whose definition carries only what the query evaluator reads. */
function rowAgent(agentName: string, source: AgentSource): AgentDefinition {
  return {
    agentName,
    name: agentName,
    description: '',
    body: '',
    source,
    origin: source === 'bundled' ? 'built-in' : 'user',
    providerId: source,
    extra: {},
    path: `/rows/${source}/${agentName}.agent.md`,
  }
}

describe('control core over the in-memory adapter', () => {
  it('snapshot merges both layers and normalizes findings with origins', async () => {
    const core = createCore({
      files: {
        [`${PROJECT}/.git`]: '',
        [`${PROJECT_AGENTS}/gamma/gamma.agent.md`]: '---\nname: Gamma\nmodelOrder: [missing-alias]\n---\n',
        [DOC_BETA]: BETA_TEXT,
        [REGISTRY_PROJECT]: REGISTRY_PROJECT_TEXT,
        [REGISTRY_USER]: REGISTRY_USER_TEXT,
      },
      agentDiagnostics: [{ path: '/nowhere/loose.agent.md', code: 'unparseable-frontmatter', message: 'bad', providerId: 'test' }],
    })
    const snapshot = await core.snapshot({ cwd: PROJECT })
    expect(snapshot.agents.map((agent) => agent.agentName)).toEqual(['gamma', 'beta'])
    expect(snapshot.models.map((model) => model.modelName)).toEqual(['gpt5', 'kimi'])
    expect(snapshot.aliases.map((alias) => alias.alias)).toEqual(['smart'])
    // The layered projection behind the merged lists (ticket 57): the workspace
    // layer declares first, the global layer keeps its own shadowed declaration.
    expect(snapshot.registryLayers.map((layer) => [
      layer.source,
      layer.models.map((model) => model.modelName),
      layer.aliases.map((alias) => alias.alias),
    ])).toEqual([
      ['project-dsh', ['gpt5'], ['smart']],
      ['user-dsh', ['kimi'], []],
    ])
    const origins = snapshot.findings.map((finding) => finding.origin)
    expect(origins).toContain('agent-scan')
    expect(origins).toContain('cross-layer')
    const cross = snapshot.findings.find((finding) => finding.origin === 'cross-layer')
    expect(cross !== undefined && cross.finding.code === 'unknown-alias').toBe(true)
  })

  it('omits the workspace layer from a user-global snapshot', async () => {
    const snapshot = await createCore().snapshot({ cwd: null })

    expect(snapshot.registryLayers.map((layer) => layer.source)).toEqual(['user-dsh'])
  })

  it('compose exposes byte-exact blocks and rejects unknown agents', async () => {
    const core = createCore()
    const doc = await core.compose('alpha', { cwd: PROJECT })
    expect(doc.path).toBe(DOC_ALPHA)
    expect(doc.source).toBe('project-dsh')
    expect(doc.framing).toEqual({ kind: 'fenced', opening: '---\n', closing: '---\n' })
    expect(doc.frontmatterText).toBe('name: Alpha\n# kept comment\nunknown-key: 1\ndescription: first\n')
    expect(doc.bodyText).toBe('Alpha body\n')
    expect(doc.baseText).toBe(ALPHA_TEXT)
    await expect(core.compose('ghost', { cwd: PROJECT })).rejects.toThrow('unknown agent')
  })

  it('plans purely: deterministic output, no document mutation, no I/O', async () => {
    const core = createCore()
    const doc = await core.compose('alpha', { cwd: PROJECT })
    const before = JSON.stringify(doc)
    const edit: DocumentEdit = { kind: 'setFrontmatterField', agentName: 'alpha', field: 'description', value: 'second' }
    const plan1 = core.plan(doc, [edit])
    const plan2 = core.plan(doc, [edit])
    expect(plan1).toEqual(plan2)
    expect(JSON.stringify(doc)).toBe(before)
    expect(core.files.get(DOC_ALPHA)).toBe(ALPHA_TEXT)
    expect(plan1.entries).toHaveLength(1)
    expect(plan1.entries[0]?.file).toBe(DOC_ALPHA)
    expect(plan1.rejections).toEqual([])
  })

  it('commits atomically and re-reads the new bytes', async () => {
    const core = createCore()
    const doc = await core.compose('alpha', { cwd: PROJECT })
    const plan = core.plan(doc, [{ kind: 'setFrontmatterField', agentName: 'alpha', field: 'description', value: 'second' }])
    const report = await core.commit(plan)
    expect(report.results).toEqual([{ ok: true, file: DOC_ALPHA }])
    expect(core.files.get(DOC_ALPHA)).toBe('---\nname: Alpha\n# kept comment\nunknown-key: 1\ndescription: second\n---\nAlpha body\n')
    const recomposed = await core.compose('alpha', { cwd: PROJECT })
    expect(recomposed.frontmatterText).toContain('description: second')
  })

  it('preserves CRLF fence bytes and untouched lines through an edit', async () => {
    const crlf = '---\r\nname: Alpha\r\n---\r\nbody one\r\n'
    const core = createCore({ files: { [`${PROJECT}/.git`]: '', [DOC_ALPHA]: crlf, [REGISTRY_PROJECT]: REGISTRY_PROJECT_TEXT } })
    const doc = await core.compose('alpha', { cwd: PROJECT })
    expect(doc.framing).toEqual({ kind: 'fenced', opening: '---\r\n', closing: '---\r\n' })
    const plan = core.plan(doc, [{ kind: 'setBlockText', agentName: 'alpha', blockId: 'prose', text: 'body two' }])
    const report = await core.commit(plan)
    expect(report.results).toEqual([{ ok: true, file: DOC_ALPHA }])
    expect(core.files.get(DOC_ALPHA)).toBe('---\r\nname: Alpha\r\n---\r\nbody two')
  })

  it('reports a conflict when the file changed since it was composed', async () => {
    const core = createCore()
    const doc = await core.compose('alpha', { cwd: PROJECT })
    core.files.set(DOC_ALPHA, 'changed on disk\n')
    const plan = core.plan(doc, [{ kind: 'setFrontmatterField', agentName: 'alpha', field: 'description', value: 'second' }])
    const report = await core.commit(plan)
    expect(report.results).toEqual([{ ok: false, file: DOC_ALPHA, code: 'conflict', message: expect.any(String) }])
    expect(core.files.get(DOC_ALPHA)).toBe('changed on disk\n')
  })

  it('produces no entry for a no-op edit (D14 untouched round trip)', async () => {
    const core = createCore()
    const doc = await core.compose('alpha', { cwd: PROJECT })
    const plan = core.plan(doc, [
      { kind: 'setBlockText', agentName: 'alpha', blockId: 'frontmatter', text: doc.frontmatterText },
      { kind: 'setBlockText', agentName: 'alpha', blockId: 'prose', text: doc.bodyText },
    ])
    expect(plan.entries).toEqual([])
    expect(plan.rejections).toEqual([])
  })

  it('rejects edits the document cannot absorb, as data', async () => {
    const core = createCore()
    const beta = await core.compose('beta', { cwd: PROJECT })
    const plan = core.plan(beta, [{ kind: 'setBlockText', agentName: 'beta', blockId: 'frontmatter', text: 'name: x\n' }])
    expect(plan.entries).toEqual([])
    expect(plan.rejections).toEqual([{ code: 'unknown-block', message: expect.any(String), editIndex: 0 }])

    const alpha = await core.compose('alpha', { cwd: PROJECT })
    const rolled = core.plan(alpha, [{ kind: 'setFrontmatterField', agentName: 'alpha', field: 'spawn', value: 'sometimes' }])
    expect(rolled.entries).toEqual([])
    expect(rolled.rejections).toEqual([{ code: 'invalid-field', message: expect.any(String), editIndex: 0 }])
  })

  it('a plain document gains a synthesized fence through a field edit', async () => {
    const core = createCore()
    const beta = await core.compose('beta', { cwd: PROJECT })
    const plan = core.plan(beta, [
      { kind: 'setFrontmatterField', agentName: 'beta', field: 'description', value: 'added' },
      { kind: 'setBlockText', agentName: 'beta', blockId: 'prose', text: 'still prose\n' },
    ])
    const report = await core.commit(plan)
    expect(report.results).toEqual([{ ok: true, file: DOC_BETA }])
    expect(core.files.get(DOC_BETA)).toBe('---\ndescription: added\n---\nstill prose\n')
  })

  it('the doc port groups dirty edits per agent and commits in one report', async () => {
    const core = createCore()
    const port = createAgentDocPort(core, { cwd: PROJECT })
    const doc = await port.read('alpha')
    expect(doc.agentName).toBe('alpha')
    const report = await port.commit([
      { kind: 'setFrontmatterField', agentName: 'alpha', field: 'description', value: 'via port' },
      { kind: 'setBlockText', agentName: 'beta', blockId: 'prose', text: 'beta prose\n' },
      { kind: 'setFrontmatterField', agentName: 'ghost', field: 'name', value: 'x' },
    ])
    expect(report.results).toEqual([
      { ok: true, file: DOC_ALPHA },
      { ok: true, file: DOC_BETA },
    ])
    expect(core.files.get(DOC_ALPHA)).toContain('description: via port')
    expect(core.files.get(DOC_BETA)).toBe('beta prose\n')
    port.invalidate()
  })

  it('lands registry edits in the right layer file and invalidates the registry', async () => {
    const core = createCore()
    const report = await core.applyRegistryEdit({ kind: 'setAvailable', modelName: 'kimi', available: true })
    expect(report.results).toEqual([{ ok: true, file: REGISTRY_USER }])
    expect(core.files.get(REGISTRY_USER)).toBe('models:\n  kimi:\n    provider: moonshot\n    model: kimi-2\n    available: true\n')
    const models = (await core.snapshot({ cwd: PROJECT })).models
    expect(models.find((model) => model.modelName === 'kimi')?.available).toBe(true)
  })

  it('addModel appends the entry to the models section, fields in order, and reports the file', async () => {
    const core = createCore()
    const added = await core.applyRegistryEdit({
      kind: 'addModel',
      modelName: 'sonnet',
      provider: 'anthropic',
      model: 'claude-sonnet',
      sysPrompt: 'Be terse.',
      available: false,
      source: 'project-dsh',
    })

    expect(added.results).toEqual([{ ok: true, file: REGISTRY_PROJECT }])
    // A worked example, not a recomputation: the seed text plus the literal
    // block the writer is expected to produce.
    expect(core.files.get(REGISTRY_PROJECT)).toBe(TWO_MODEL_REGISTRY)
  })

  it('addAlias appends the flow-sequence entry under the aliases section and the snapshot lists it', async () => {
    const core = seededCore(TWO_MODEL_REGISTRY)
    await core.applyRegistryEdit({ kind: 'addAlias', alias: 'fast', target: 'sonnet', source: 'project-dsh' })

    expect(core.files.get(REGISTRY_PROJECT)).toBe(TWO_MODEL_REGISTRY + '  fast: [sonnet]\n')
    const snapshot = await core.snapshot({ cwd: PROJECT })
    expect(snapshot.aliases.map((alias) => alias.alias)).toEqual(['smart', 'fast'])
  })

  it('deleteModel removes only that entry and leaves the aliases section intact', async () => {
    const core = seededCore(TWO_MODEL_REGISTRY + '  fast: [sonnet]\n')
    const removed = await core.applyRegistryEdit({ kind: 'deleteModel', modelName: 'gpt5' })

    expect(removed.results).toEqual([{ ok: true, file: REGISTRY_PROJECT }])
    expect(core.files.get(REGISTRY_PROJECT)).toBe(
      'models:\n'
      + '  sonnet:\n'
      + '    provider: anthropic\n'
      + '    model: claude-sonnet\n'
      + '    sysPrompt: Be terse.\n'
      + '    available: false\n'
      + 'aliases:\n'
      + '  smart: [gpt5]\n'
      + '  fast: [sonnet]\n',
    )
  })

  it('remaps a block-sequence alias by replacing the whole entry', async () => {
    // The long form of an alias is a block sequence under the entry line; a
    // remap that only rewrote the entry line would leave the stale `- gpt5`
    // behind as a dangling block.
    const core = createCore({
      files: { [REGISTRY_PROJECT]: 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\naliases:\n  smart:\n    - gpt5\n' },
    })
    const report = await core.applyRegistryEdit({ kind: 'remapAlias', alias: 'smart', target: 'kimi' })
    expect(report.results).toEqual([{ ok: true, file: REGISTRY_PROJECT }])
    expect(core.files.get(REGISTRY_PROJECT)).toBe(
      'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\naliases:\n  smart: [kimi]\n',
    )
    const snapshot = await core.snapshot({ cwd: PROJECT })
    expect(snapshot.aliases[0]).toMatchObject({ alias: 'smart', targets: ['kimi'] })
  })

  it('refuses registry edits that would corrupt or duplicate', async () => {
    const core = createCore()
    const refusals: Array<[Parameters<InMemoryControlCore['applyRegistryEdit']>[0], string]> = [
      [{ kind: 'addAlias', alias: 'smart', target: 'gpt5', source: 'project-dsh' }, 'already exists'],
      [{ kind: 'addModel', modelName: 'gpt5', provider: 'x', model: 'y', source: 'project-dsh' }, 'already exists'],
      [{ kind: 'addAlias', alias: 'dsh-default', target: 'gpt5', source: 'project-dsh' }, 'reserved'],
      [{ kind: 'addAlias', alias: 'broken-name!', target: 'gpt5', source: 'project-dsh' }, 'not a valid'],
      [{ kind: 'addAlias', alias: 'ok', target: 'ghost-model', source: 'project-dsh' }, 'not a model'],
    ]
    for (const [edit, needle] of refusals) {
      const report = await core.applyRegistryEdit(edit)
      const result = report.results[0]
      expect(result?.ok).toBe(false)
      expect(result?.ok === false && result.message).toContain(needle)
    }
    expect(core.files.get(REGISTRY_PROJECT)).toBe(REGISTRY_PROJECT_TEXT)
  })

  it('refuses edits to built-in entries and to a layer file that does not parse', async () => {
    const core = createCore({
      readDefaultPair: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    })
    const readOnly = await core.applyRegistryEdit({ kind: 'deleteAlias', alias: 'dsh-default' })
    expect(readOnly.results[0]).toMatchObject({ ok: false, code: 'read-only' })

    core.files.set(REGISTRY_USER, 'models: [broken\n')
    const broken = await core.applyRegistryEdit({ kind: 'setAvailable', modelName: 'kimi', available: true })
    expect(broken.results[0]).toMatchObject({ ok: false, code: 'invalid-content' })
    expect(core.files.get(REGISTRY_USER)).toBe('models: [broken\n')
  })

  it('reports an unknown registry entry as not-found', async () => {
    const core = createCore()
    const report = await core.applyRegistryEdit({ kind: 'setSysPrompt', modelName: 'ghost', sysPrompt: 'x' })
    expect(report.results[0]).toMatchObject({ ok: false, code: 'not-found' })
  })

  /**
   * Three fixture rows laid out so that the name, issue and layer axes each
   * produce a *different* order. Without that, a broken sort falls back to the
   * name tie-break and still passes:
   *
   *   name  : alpha, mike, zulu
   *   issues: mike(0), zulu(1), alpha(2)
   *   layer : mike(project-dsh), zulu(user-dsh), alpha(bundled)
   */
  function queryRows(): AgentRow[] {
    return [
      { agent: rowAgent('alpha', 'bundled'), errors: 2, hints: 0 },
      { agent: rowAgent('mike', 'project-dsh'), errors: 0, hints: 0 },
      { agent: rowAgent('zulu', 'user-dsh'), errors: 1, hints: 0 },
    ]
  }

  const QUERY_CASES: readonly {
    readonly label: string
    readonly query: AgentListQuery
    readonly expected: readonly string[]
  }[] = [
    { label: 'the layer filter', query: { layer: 'project' }, expected: ['mike'] },
    { label: 'the case-insensitive text filter', query: { text: 'MIK' }, expected: ['mike'] },
    { label: 'the only-issues filter', query: { onlyIssues: true }, expected: ['alpha', 'zulu'] },
    { label: 'the issues sort ascending', query: { sort: 'issues' }, expected: ['mike', 'zulu', 'alpha'] },
    { label: 'the issues sort descending', query: { sort: 'issues', direction: 'desc' }, expected: ['alpha', 'zulu', 'mike'] },
    { label: 'the layer sort', query: { sort: 'layer' }, expected: ['mike', 'zulu', 'alpha'] },
    { label: 'the layer sort descending', query: { sort: 'layer', direction: 'desc' }, expected: ['alpha', 'zulu', 'mike'] },
    { label: 'the default name sort', query: {}, expected: ['alpha', 'mike', 'zulu'] },
  ]

  it.each(QUERY_CASES)('evaluateAgentQuery applies $label', ({ query, expected }) => {
    const rows = queryRows()

    expect(evaluateAgentQuery(rows, query).map((row) => row.agent.agentName)).toEqual(expected)
  })

  it('the layer sort follows the contract rank table across all five roots', () => {
    // 簇 F: the `layer` axis reads the contract's one rank table. The rows are
    // declared in reverse rank order and the expectation is a literal, so this
    // fails if the table's order changes (not just if the evaluator reads it).
    const declared = ['bundled', 'user-agents', 'user-dsh', 'project-agents', 'project-dsh'] as const
    const rows: AgentRow[] = declared.map((source) => ({ agent: rowAgent(source, source), errors: 0, hints: 0 }))

    expect(evaluateAgentQuery(rows, { sort: 'layer' }).map((row) => row.agent.agentName)).toEqual([
      'project-dsh',
      'project-agents',
      'user-dsh',
      'user-agents',
      'bundled',
    ])
  })
})

describe('agent list query evaluator (ticket 27)', () => {
  /** One list row; only the definition fields the evaluator reads are filled. */
  function createRow(
    agentName: string,
    source: AgentSource,
    chain: Pick<AgentDefinition, 'modelOrder' | 'model'> = {},
  ): AgentRow {
    return { agent: { ...rowAgent(agentName, source), ...chain }, errors: 0, hints: 0 }
  }

  /** All five discovery roots, one row each. */
  function layerRows(): AgentRow[] {
    return [
      createRow('project-dsh', 'project-dsh'),
      createRow('project-agents', 'project-agents'),
      createRow('user-dsh', 'user-dsh'),
      createRow('user-agents', 'user-agents'),
      createRow('bundled', 'bundled'),
    ]
  }

  const RAW_TARGET = { provider: 'openai', model: 'gpt-5' } as const

  it('the project layer filter selects exactly the two project sources', () => {
    const rows = layerRows()
    expect(evaluateAgentQuery(rows, { layer: 'project' }).map((row) => row.agent.agentName)).toEqual([
      'project-agents',
      'project-dsh',
    ])
  })

  it('the user layer filter selects exactly the two user sources', () => {
    const rows = layerRows()
    expect(evaluateAgentQuery(rows, { layer: 'user' }).map((row) => row.agent.agentName)).toEqual([
      'user-agents',
      'user-dsh',
    ])
  })

  it('the bundled layer filter selects exactly the bundled source', () => {
    const rows = layerRows()
    expect(evaluateAgentQuery(rows, { layer: 'bundled' }).map((row) => row.agent.agentName)).toEqual(['bundled'])
  })

  /** Five rows whose chain sizes are 0, 1, 2, 3 and 4, with names out of size order. */
  function modelChainRows(): AgentRow[] {
    return [
      createRow('zulu', 'project-dsh'),
      createRow('alpha', 'project-dsh', { modelOrder: ['smart'] }),
      createRow('mike', 'project-dsh', { modelOrder: ['smart'], model: [RAW_TARGET] }),
      createRow('bravo', 'project-dsh', { modelOrder: ['smart', 'fast', 'deep'] }),
      createRow('echo', 'project-dsh', { modelOrder: ['smart', 'fast'], model: [RAW_TARGET, RAW_TARGET] }),
    ]
  }

  it('orders rows by the summed alias and legacy chain size ascending', () => {
    const rows = modelChainRows()
    expect(evaluateAgentQuery(rows, { sort: 'models' }).map((row) => row.agent.agentName)).toEqual([
      'zulu',
      'alpha',
      'mike',
      'bravo',
      'echo',
    ])
  })

  it('orders rows by the summed alias and legacy chain size descending', () => {
    const rows = modelChainRows()
    expect(evaluateAgentQuery(rows, { sort: 'models', direction: 'desc' }).map((row) => row.agent.agentName)).toEqual([
      'echo',
      'bravo',
      'mike',
      'alpha',
      'zulu',
    ])
  })

  it('breaks a chain-size tie by agent name, in both directions', () => {
    const rows = [
      createRow('zeta', 'project-dsh', { modelOrder: ['smart'], model: [RAW_TARGET] }),
      createRow('alpha', 'project-dsh', { modelOrder: ['smart', 'fast'] }),
    ]
    expect(evaluateAgentQuery(rows, { sort: 'models' }).map((row) => row.agent.agentName)).toEqual(['alpha', 'zeta'])
    expect(evaluateAgentQuery(rows, { sort: 'models', direction: 'desc' }).map((row) => row.agent.agentName)).toEqual([
      'alpha',
      'zeta',
    ])
  })

  it('keeps every row for an empty or whitespace-only text query', () => {
    const rows = [
      createRow('alpha', 'project-dsh'),
      createRow('beta', 'user-dsh'),
      createRow('gamma', 'bundled'),
    ]
    const empty = evaluateAgentQuery(rows, { text: '' })
    const blank = evaluateAgentQuery(rows, { text: '   ' })
    expect(empty).toHaveLength(3)
    expect(blank).toHaveLength(3)
    expect(empty.map((row) => row.agent.agentName)).toEqual(['alpha', 'beta', 'gamma'])
    expect(blank.map((row) => row.agent.agentName)).toEqual(['alpha', 'beta', 'gamma'])
  })
})
