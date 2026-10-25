/**
 * 票 04 的投影门：`ControlSnapshot.assemblies` 只为可召唤的 Agent 生成计划。
 * 规划来自同一个 `composeSession` 解析路径与同一个 `agentAssembly` 服务，
 * 链耗尽或服务缺席都不写 key。
 */
import { describe, expect, it } from 'vitest'

import { createAssemblyService } from '../src/agent-assembly/index.ts'
import { createInMemoryControlCore, type InMemoryControlCore } from '../src/control/memory.ts'

import type { ModelSelectionPolicy } from '../src/contract/index.ts'

const PROJECT = '/assembly-proj'
const HOME = '/assembly-home'
const AGENTS = `${PROJECT}/.dsh/agents`
const REGISTRY = `${AGENTS}/registry.yaml`

const REGISTRY_TEXT = [
  'models:',
  '  chat:',
  '    provider: deepseek',
  '    model: deepseek-chat',
  '    sysPrompt: Provider {{provider}} runs {{model}}.',
  '  retired:',
  '    provider: vendor',
  '    model: retired',
  '    available: false',
  'aliases:',
  '  chat: [chat]',
  '  retired: [retired]',
  '',
].join('\n')

function doc(name: string, frontmatter: string, body: string): string {
  return `---\nname: ${name}\n${frontmatter}---\n${body}\n`
}

const DOCS: Readonly<Record<string, string>> = {
  'with-alias': doc('with-alias', 'modelOrder: [chat]\n', 'Alias body.'),
  'with-raw': doc('with-raw', 'model: [{ provider: local, model: llama }]\n', 'Raw body.'),
  'off': doc('off', 'modelOrder: [retired]\n', 'Off body.'),
  'broken': 'plain body with no chain\n',
}

/** One in-memory core over the fixture, with an optional assembly service and policy. */
function createCore(options: {
  readonly assembly?: ReturnType<typeof createAssemblyService> | undefined
  readonly selectionPolicy?: ModelSelectionPolicy | undefined
} = {}): InMemoryControlCore {
  const files: Record<string, string> = { [`${PROJECT}/.git`]: '', [REGISTRY]: REGISTRY_TEXT }
  for (const [agentName, text] of Object.entries(DOCS)) files[`${AGENTS}/${agentName}/${agentName}.agent.md`] = text
  return createInMemoryControlCore({
    projectRoot: PROJECT,
    dshHome: HOME,
    files,
    assembly: options.assembly,
    selectionPolicy: options.selectionPolicy,
  })
}

describe('ControlSnapshot.assemblies', () => {
  it('projects a plan for every resolvable agent and omits the exhausted ones', async () => {
    const assembly = createAssemblyService()
    const core = createCore({ assembly })
    const snapshot = await core.snapshot({ cwd: PROJECT })

    expect(Object.keys(snapshot.assemblies)).toEqual(['with-alias', 'with-raw'])
    const session = await core.composeSession('with-alias', { cwd: PROJECT })
    expect(snapshot.assemblies['with-alias']).toEqual(assembly.plan(session))
    expect(snapshot.assemblies['with-alias']?.sections[0]).toMatchObject({
      name: 'atelier:model-sys',
      text: 'Provider deepseek runs deepseek-chat.',
    })
    // A raw winner has no registry entry, so it contributes no model row.
    expect(snapshot.assemblies['with-raw']?.sections.some((section) => section.name === 'atelier:model-sys')).toBe(false)
    expect(snapshot.assemblies['with-raw']?.sections.some((section) => section.name === 'deployment:persona-prefix')).toBe(true)
  })

  it('projects nothing when no assembly service is mounted', async () => {
    const snapshot = await createCore().snapshot({ cwd: PROJECT })

    expect(snapshot.assemblies).toEqual({})
  })

  it('omits agents whose chain the host allowlist refuses', async () => {
    const core = createCore({
      assembly: createAssemblyService(),
      selectionPolicy: { routes: [{ provider: 'local', model: 'llama' }] },
    })
    const snapshot = await core.snapshot({ cwd: PROJECT })

    // Only the raw pair is allowed; the alias route is refused by policy.
    expect(Object.keys(snapshot.assemblies)).toEqual(['with-raw'])
  })

  it('uses the same config the service plans with (both call paths agree)', async () => {
    const assembly = createAssemblyService({ config: { sectionOrder: ['deployment:persona-prefix', 'atelier:model-sys'] } })
    const core = createCore({ assembly })
    const snapshot = await core.snapshot({ cwd: PROJECT })

    expect(snapshot.assemblies['with-alias']?.lints).toHaveLength(1)
    expect(snapshot.assemblies['with-alias']).toEqual(assembly.plan(await core.composeSession('with-alias', { cwd: PROJECT })))
  })
})
