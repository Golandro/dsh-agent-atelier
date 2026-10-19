import { describe, expect, it } from 'vitest'

import { evaluateAgentQuery } from '../src/control/index.ts'
import { createAgentDocPort } from '../src/control/core.ts'
import { createInMemoryControlCore } from '../src/control/memory.ts'

import type { AgentRow, DocumentEdit } from '../src/control/index.ts'
import type { InMemoryControlCore } from '../src/control/memory.ts'

const PROJECT = '/dsh-proj'
const HOME = '/dsh-home'
const PROJECT_AGENTS = `${PROJECT}/.dsh/agents`
const HOME_AGENTS = `${HOME}/agents`
const DOC_ALPHA = `${PROJECT_AGENTS}/alpha/alpha.agent.md`
const DOC_BETA = `${HOME_AGENTS}/beta/beta.agent.md`
const REGISTRY_PROJECT = `${PROJECT_AGENTS}/registry.yaml`
const REGISTRY_USER = `${HOME_AGENTS}/registry.yaml`

const ALPHA_TEXT = '---\nname: Alpha\n# kept comment\nunknown-key: 1\ndescription: first\n---\nAlpha body\n'
const BETA_TEXT = 'plain beta body\n'
const REGISTRY_PROJECT_TEXT = 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\naliases:\n  smart: [gpt5]\n'
const REGISTRY_USER_TEXT = 'models:\n  kimi:\n    provider: moonshot\n    model: kimi-2\n    available: false\n'

/** One in-memory core with the standard two-agent, two-layer fixture. */
function createCore(overrides: Parameters<typeof createInMemoryControlCore>[0] = {}): InMemoryControlCore {
  return createInMemoryControlCore({
    projectRoot: PROJECT,
    dshHome: HOME,
    files: {
      [`${PROJECT}/.git`]: '',
      [DOC_ALPHA]: ALPHA_TEXT,
      [DOC_BETA]: BETA_TEXT,
      [REGISTRY_PROJECT]: REGISTRY_PROJECT_TEXT,
      [REGISTRY_USER]: REGISTRY_USER_TEXT,
    },
    ...overrides,
  })
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
    const origins = snapshot.findings.map((finding) => finding.origin)
    expect(origins).toContain('agent-scan')
    expect(origins).toContain('cross-layer')
    const cross = snapshot.findings.find((finding) => finding.origin === 'cross-layer')
    expect(cross !== undefined && cross.finding.code === 'unknown-alias').toBe(true)
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

  it('adds and removes registry entries with the section structure preserved', async () => {
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
    expect(core.files.get(REGISTRY_PROJECT)).toBe(
      'models:\n'
      + '  gpt5:\n'
      + '    provider: openai\n'
      + '    model: gpt-5\n'
      + '  sonnet:\n'
      + '    provider: anthropic\n'
      + '    model: claude-sonnet\n'
      + '    sysPrompt: Be terse.\n'
      + '    available: false\n'
      + 'aliases:\n'
      + '  smart: [gpt5]\n',
    )
    await core.applyRegistryEdit({ kind: 'addAlias', alias: 'fast', target: 'sonnet', source: 'project-dsh' })
    expect(core.files.get(REGISTRY_PROJECT)).toContain('  fast: [sonnet]\n')
    const snapshot = await core.snapshot({ cwd: PROJECT })
    expect(snapshot.aliases.map((alias) => alias.alias)).toEqual(['smart', 'fast'])

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

  it('evaluateAgentQuery filters and sorts the rows', async () => {
    const core = createCore()
    const snapshot = await core.snapshot({ cwd: PROJECT })
    const issues = new Map<string, { errors: number; hints: number }>([['beta', { errors: 1, hints: 0 }]])
    const rows: AgentRow[] = snapshot.agents.map((agent) => ({ agent, errors: issues.get(agent.agentName)?.errors ?? 0, hints: 0 }))
    expect(evaluateAgentQuery(rows, { layer: 'project' }).map((row) => row.agent.agentName)).toEqual(['alpha'])
    expect(evaluateAgentQuery(rows, { text: 'ALP' }).map((row) => row.agent.agentName)).toEqual(['alpha'])
    expect(evaluateAgentQuery(rows, { onlyIssues: true }).map((row) => row.agent.agentName)).toEqual(['beta'])
    expect(evaluateAgentQuery(rows, { sort: 'issues' }).map((row) => row.agent.agentName)).toEqual(['alpha', 'beta'])
    expect(evaluateAgentQuery(rows, { sort: 'issues', direction: 'desc' }).map((row) => row.agent.agentName)).toEqual(['beta', 'alpha'])
    expect(evaluateAgentQuery(rows, { sort: 'layer' }).map((row) => row.agent.agentName)).toEqual(['alpha', 'beta'])
    expect(evaluateAgentQuery(rows, {})).toHaveLength(2)
  })
})
