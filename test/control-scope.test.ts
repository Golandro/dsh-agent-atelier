/**
 * 工作空间范围门（票 37 / ADR-0007）。
 *
 * 这里锁死「cwd 是发现起点、不是身份」的三条语义：显式目录按走查找项目根、
 * 显式 null 落用户全局、目录不存在时报告无项目根。另锁 registry 编辑与读取
 * 用同一范围（之前注册表编辑永远落宿主默认层）。
 */
import { describe, expect, it } from 'vitest'

import { createInMemoryControlCore } from '../src/control/memory.ts'

import type { InMemoryControlCore, InMemoryControlOptions } from '../src/control/memory.ts'

const WORKSPACE = '/scope-ws'
const NESTED = `${WORKSPACE}/sub`
const OTHER = '/scope-other'
const GONE = '/scope-gone'
const HOME = '/scope-home'

const WS_DOC = `${WORKSPACE}/.dsh/agents/alpha/alpha.agent.md`
const WS_REGISTRY = `${WORKSPACE}/.dsh/agents/registry.yaml`
const OTHER_DOC = `${OTHER}/.dsh/agents/beta/beta.agent.md`
const OTHER_REGISTRY = `${OTHER}/.dsh/agents/registry.yaml`
const USER_DOC = `${HOME}/agents/gamma/gamma.agent.md`

const REGISTRY_TEXT = 'models:\n  gpt5:\n    provider: openai\n    model: gpt-5\n'

const FILES: Record<string, string> = {
  [`${WORKSPACE}/.git`]: '',
  [`${NESTED}/.keep`]: '',
  [WS_DOC]: '---\nname: Alpha\ndescription: workspace agent\n---\nAlpha body\n',
  [WS_REGISTRY]: REGISTRY_TEXT,
  [OTHER_DOC]: '---\nname: Beta\ndescription: other agent\n---\nBeta body\n',
  [OTHER_REGISTRY]: REGISTRY_TEXT,
  [USER_DOC]: '---\nname: Gamma\ndescription: user agent\n---\nGamma body\n',
}

/** The same walk the host row injects: stop at `.git`, fall back to cwd, absent = none. */
function walkToProjectRoot(files: Record<string, string>) {
  const exists = (path: string): boolean =>
    files[path] !== undefined || Object.keys(files).some((key) => key.startsWith(`${path}/`))
  return async (cwd: string): Promise<string | undefined> => {
    if (!exists(cwd)) return undefined
    let current = cwd
    for (;;) {
      if (exists(`${current}/.git`)) return current
      const parent = current.slice(0, current.lastIndexOf('/')) || '/'
      if (parent === current) return cwd
      current = parent
    }
  }
}

function createCore(overrides: Partial<InMemoryControlOptions> = {}): InMemoryControlCore {
  return createInMemoryControlCore({
    projectRoot: WORKSPACE,
    dshHome: HOME,
    files: FILES,
    resolveProjectRootFor: walkToProjectRoot(FILES),
    ...overrides,
  })
}

const namesOf = (core: { agents: readonly { agentName: string }[] }): string[] =>
  core.agents.map((agent) => agent.agentName)

describe('工作空间范围：读取', () => {
  it('未指定 cwd 时沿用宿主默认，并报告它的项目根', async () => {
    const snapshot = await createCore().snapshot()
    expect(namesOf(snapshot)).toEqual(['alpha', 'gamma'])
    expect(snapshot.scope).toEqual({ cwd: WORKSPACE, projectRoot: WORKSPACE })
  })

  it('显式 cwd 扫描该工作空间的项目层，用户层始终在', async () => {
    const snapshot = await createCore().snapshot({ cwd: OTHER })
    expect(namesOf(snapshot)).toEqual(['beta', 'gamma'])
    expect(snapshot.scope).toEqual({ cwd: OTHER, projectRoot: OTHER })
  })

  it('cwd 是子目录时按走查找真正的项目根', async () => {
    const snapshot = await createCore().snapshot({ cwd: NESTED })
    expect(namesOf(snapshot)).toEqual(['alpha', 'gamma'])
    expect(snapshot.scope).toEqual({ cwd: NESTED, projectRoot: WORKSPACE })
  })

  it('cwd 为 null 是用户全局：只扫用户层与随包', async () => {
    const snapshot = await createCore().snapshot({ cwd: null })
    expect(namesOf(snapshot)).toEqual(['gamma'])
    expect(snapshot.scope).toEqual({ cwd: null, projectRoot: null })
  })

  it('目录已不存在时报告无项目根，数据退化为用户全局', async () => {
    const snapshot = await createCore().snapshot({ cwd: GONE })
    expect(namesOf(snapshot)).toEqual(['gamma'])
    expect(snapshot.scope).toEqual({ cwd: GONE, projectRoot: null })
  })

  it('compose 也遵守范围：用户全局下看不到项目层 Agent', async () => {
    const core = createCore()
    await expect(core.compose('alpha', { cwd: null })).rejects.toThrow('alpha')
    await expect(core.compose('alpha', { cwd: OTHER })).rejects.toThrow('alpha')
    await expect(core.compose('alpha', { cwd: WORKSPACE })).resolves.toMatchObject({ agentName: 'alpha' })
  })
})

describe('工作空间范围：注册表编辑', () => {
  it('编辑落所选工作空间的项目层，而不是宿主默认层', async () => {
    const core = createCore()
    const report = await core.applyRegistryEdit(
      { kind: 'setAvailable', modelName: 'gpt5', available: false },
      { cwd: OTHER },
    )

    expect(report.results).toEqual([{ ok: true, file: OTHER_REGISTRY }])
    expect(core.files.get(OTHER_REGISTRY)).toContain('available: false')
    expect(core.files.get(WS_REGISTRY)).toBe(REGISTRY_TEXT)
  })

  it('用户全局下项目层编辑被拒（层不存在），不落到任何文件', async () => {
    const core = createCore()
    const report = await core.applyRegistryEdit(
      { kind: 'setAvailable', modelName: 'gpt5', available: false },
      { cwd: null },
    )

    expect(report.results).toHaveLength(1)
    expect(report.results[0]?.ok).toBe(false)
    expect(core.files.get(WS_REGISTRY)).toBe(REGISTRY_TEXT)
    expect(core.files.get(OTHER_REGISTRY)).toBe(REGISTRY_TEXT)
  })

  it('未指定 cwd 时仍按宿主默认层编辑（内部调用者的既有语义）', async () => {
    const core = createCore()
    const report = await core.applyRegistryEdit({ kind: 'setAvailable', modelName: 'gpt5', available: false })

    expect(report.results).toEqual([{ ok: true, file: WS_REGISTRY }])
    expect(core.files.get(WS_REGISTRY)).toContain('available: false')
  })
})
