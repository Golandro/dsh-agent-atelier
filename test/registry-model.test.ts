/**
 * 票 61 registry 纯视图模型的行为锚点：层关系、池解析、fan-in、可达面、
 * 影响面、稳定 key 与唯一查询求值器。测试全部走模块的纯接口，不挂 React，
 * 也不依赖宿主 / 文件系统。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  agentsUsingAlias,
  buildAliasRows,
  buildModelRows,
  buildRegistryRows,
  evaluateRegistryQuery,
  healthLabel,
  remapImpact,
  rowKey,
} from '../client-registry/registry-model.ts'

import type {
  AgentDefinition,
  AliasDeclaration,
  AliasDefinition,
  AliasRegistryLayerSnapshot,
  ModelDeclaration,
  ModelDefinition,
} from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'

const PROJECT_PATH = '/work/.dsh/agents/registry.yaml'
const USER_PATH = '/home/me/.dsh/agents/registry.yaml'

interface ModelOptions {
  readonly source?: ModelDefinition['source'] | undefined
  readonly path?: string | undefined
  readonly available?: boolean | undefined
  readonly modelGroup?: string | undefined
  readonly sysPrompt?: string | undefined
  readonly synthesized?: boolean | undefined
}

function modelDefinition(
  modelName: string,
  provider: string,
  model: string,
  options: ModelOptions = {},
): ModelDefinition {
  const source = options.source ?? 'project-dsh'
  const path =
    options.path ??
    (source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH)
  return {
    modelName,
    provider,
    model,
    available: options.available ?? true,
    source,
    ...(path === undefined ? {} : { path }),
    ...(options.modelGroup === undefined ? {} : { modelGroup: options.modelGroup }),
    ...(options.sysPrompt === undefined ? {} : { sysPrompt: options.sysPrompt }),
    ...(options.synthesized === true ? { synthesized: true } : {}),
  }
}

function aliasDefinition(
  alias: string,
  targets: readonly string[],
  options: {
    readonly source?: AliasDefinition['source'] | undefined
    readonly path?: string | undefined
  } = {},
): AliasDefinition {
  const source = options.source ?? 'project-dsh'
  const path =
    options.path ??
    (source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH)
  return { alias, targets, source, ...(path === undefined ? {} : { path }) }
}

interface RawModelOptions {
  readonly available?: boolean | undefined
  readonly modelGroup?: string | undefined
  readonly sysPrompt?: string | undefined
}

function rawModel(
  modelName: string,
  provider: string,
  model: string,
  options: RawModelOptions = {},
): ModelDeclaration {
  return {
    modelName,
    provider,
    model,
    available: options.available ?? true,
    ...(options.modelGroup === undefined ? {} : { modelGroup: options.modelGroup }),
    ...(options.sysPrompt === undefined ? {} : { sysPrompt: options.sysPrompt }),
  }
}

function rawAlias(alias: string, targets: readonly string[]): AliasDeclaration {
  return { alias, targets }
}

function layer(
  source: AliasRegistryLayerSnapshot['source'],
  models: readonly ModelDeclaration[] = [],
  aliases: readonly AliasDeclaration[] = [],
): AliasRegistryLayerSnapshot {
  return {
    source,
    path: source === 'project-dsh' ? PROJECT_PATH : USER_PATH,
    models,
    aliases,
  }
}

function agentDefinition(agentName: string, modelOrder?: readonly string[]): AgentDefinition {
  return {
    agentName,
    name: agentName,
    description: `${agentName} agent`,
    body: `${agentName} body`,
    ...(modelOrder === undefined ? {} : { modelOrder }),
    source: 'project-agents',
    origin: 'user',
    providerId: 'project-agents',
    extra: {},
    path: `/work/.agents/${agentName}/agent.md`,
  }
}

function snapshotOf(input: {
  readonly models?: readonly ModelDefinition[] | undefined
  readonly aliases?: readonly AliasDefinition[] | undefined
  readonly layers?: readonly AliasRegistryLayerSnapshot[] | undefined
  readonly agents?: readonly AgentDefinition[] | undefined
}): ControlSnapshot {
  return {
    models: input.models ?? [],
    aliases: input.aliases ?? [],
    registryLayers: input.layers ?? [],
    agents: input.agents ?? [],
    agentDiagnostics: [],
    aliasDiagnostics: [],
    findings: [],
    assemblies: {},
    scope: { cwd: '/work', projectRoot: '/work' },
  }
}

function pick<T extends { readonly name: string }>(rows: readonly T[], name: string): T {
  const row = rows.find((entry) => entry.name === name)
  expect(row, `row "${name}" should exist`).toBeDefined()
  return row as T
}

function baseSnapshot(): ControlSnapshot {
  const project = layer(
    'project-dsh',
    [
      rawModel('fast', 'acme', 'chat'),
      rawModel('slow', 'acme', 'slow', { available: false }),
      rawModel('alt-fast', 'acme', 'chat'),
    ],
    [
      rawAlias('primary', ['fast', 'slow']),
      rawAlias('legacy', ['fast']),
      rawAlias('alt', ['alt-fast']),
      rawAlias('pool', ['fast', 'alt-fast']),
    ],
  )
  const user = layer(
    'user-dsh',
    [
      // 被 project 同名覆盖的 raw 声明：provider 与 available 都不同。
      rawModel('fast', 'other', 'alt', { available: false }),
      rawModel('backup', 'acme', 'slow'),
    ],
    [
      // raw targets 与生效别名 primary 的 targets 不同，专门用来验证
      // 「层行用 raw 声明，关联用合并生效面」。
      rawAlias('primary', ['backup']),
      rawAlias('backup', ['backup']),
    ],
  )
  return snapshotOf({
    models: [
      modelDefinition('fast', 'acme', 'chat'),
      modelDefinition('slow', 'acme', 'slow', { available: false }),
      modelDefinition('alt-fast', 'acme', 'chat'),
      modelDefinition('backup', 'acme', 'slow', { source: 'user-dsh' }),
      modelDefinition('dsh-default', 'acme', 'chat', { source: 'built-in', synthesized: true }),
    ],
    aliases: [
      aliasDefinition('primary', ['fast', 'slow']),
      aliasDefinition('legacy', ['fast']),
      aliasDefinition('alt', ['alt-fast']),
      aliasDefinition('pool', ['fast', 'alt-fast']),
      aliasDefinition('backup', ['backup'], { source: 'user-dsh' }),
      aliasDefinition('dsh-default', ['fast'], { source: 'built-in' }),
    ],
    layers: [project, user],
    agents: [
      agentDefinition('alpha', ['primary']),
      agentDefinition('beta', ['backup']),
      agentDefinition('gamma', ['primary', 'legacy']),
      agentDefinition('epsilon', ['dsh-default']),
      agentDefinition('plain'),
    ],
  })
}

describe('稳定 key 与空间', () => {
  it('key 统一为 kind:space:name，层空间与 merged 不串号', () => {
    const snapshot = baseSnapshot()
    expect(rowKey('alias', 'merged', 'primary')).toBe('alias:merged:primary')
    expect(rowKey('model', 'user', 'fast')).toBe('model:user:fast')

    const mergedAlias = pick(buildAliasRows(snapshot, 'merged'), 'primary')
    const projectAlias = pick(buildAliasRows(snapshot, 'project'), 'primary')
    const userAlias = pick(buildAliasRows(snapshot, 'user'), 'primary')
    expect(mergedAlias.key).toBe('alias:merged:primary')
    expect(projectAlias.key).toBe('alias:project:primary')
    expect(userAlias.key).toBe('alias:user:primary')

    const mergedModel = pick(buildModelRows(snapshot, 'merged'), 'fast')
    expect(mergedModel.key).toBe('model:merged:fast')
    expect(pick(buildModelRows(snapshot, 'project'), 'fast').key).toBe('model:project:fast')
    expect(buildRegistryRows(snapshot, 'merged', 'alias')).toHaveLength(buildAliasRows(snapshot, 'merged').length)
    expect(buildRegistryRows(snapshot, 'merged', 'model')).toHaveLength(buildModelRows(snapshot, 'merged').length)
  })
})

describe('层关系：遮蔽 / 覆盖 / 被覆盖 / 接管', () => {
  const snapshot = baseSnapshot()

  it('merged 行显示遮蔽 N，并指向删掉赢家后的接管层', () => {
    const mergedAlias = pick(buildAliasRows(snapshot, 'merged'), 'primary')
    expect(mergedAlias.layer).toMatchObject({ kind: 'shadows', count: 1, label: '遮蔽 1' })
    expect(mergedAlias.layer.takeover).toEqual({ source: 'user-dsh', path: USER_PATH })

    const mergedModel = pick(buildModelRows(snapshot, 'merged'), 'fast')
    expect(mergedModel.layer.kind).toBe('shadows')
    expect(mergedModel.layer.label).toBe('遮蔽 1')
  })

  it('project 行显示覆盖 N，并列出被覆盖的 user 声明', () => {
    const projectAlias = pick(buildAliasRows(snapshot, 'project'), 'primary')
    expect(projectAlias.layer).toMatchObject({ kind: 'covers', count: 1, label: '覆盖 1' })
    expect(projectAlias.layer.covered).toEqual([{ source: 'user-dsh', path: USER_PATH }])
    expect(projectAlias.layer.takeover).toEqual({ source: 'user-dsh', path: USER_PATH })

    const projectModel = pick(buildModelRows(snapshot, 'project'), 'fast')
    expect(projectModel.layer.kind).toBe('covers')
    expect(projectModel.layer.covered).toEqual([{ source: 'user-dsh', path: USER_PATH }])
  })

  it('user 行显示被覆盖，并标注高层赢家', () => {
    const userAlias = pick(buildAliasRows(snapshot, 'user'), 'primary')
    expect(userAlias.layer).toMatchObject({ kind: 'covered', count: 1, label: '被覆盖' })
    expect(userAlias.layer.coveredBy).toEqual({ source: 'project-dsh', path: PROJECT_PATH })
    expect(userAlias.layer.takeover).toBeUndefined()

    const userModel = pick(buildModelRows(snapshot, 'user'), 'fast')
    expect(userModel.layer.kind).toBe('covered')
    expect(userModel.layer.coveredBy).toEqual({ source: 'project-dsh', path: PROJECT_PATH })
  })

  it('没有同名冲突时没有层标注', () => {
    expect(pick(buildAliasRows(snapshot, 'merged'), 'backup').layer.kind).toBe('none')
    expect(pick(buildModelRows(snapshot, 'merged'), 'backup').layer.kind).toBe('none')
  })
})

describe('层行用 raw 声明，merged 行用合并快照', () => {
  const snapshot = baseSnapshot()

  it('层空间保留 raw targets 与 raw available；关联仍按生效面', () => {
    const userAlias = pick(buildAliasRows(snapshot, 'user'), 'primary')
    expect(userAlias.declaration.targets).toEqual(['backup'])
    expect(userAlias.targets).toEqual(['backup'])
    expect(userAlias.effective.targets).toEqual(['fast', 'slow'])
    // fan-in 走生效别名的路线，不按本条 raw targets 的 backup 路线。
    expect(userAlias.fanIn.map((alias) => alias.alias)).not.toContain('backup')
    expect(userAlias.fanIn.map((alias) => alias.alias)).toContain('legacy')

    const userModel = pick(buildModelRows(snapshot, 'user'), 'fast')
    expect(userModel.declaration.available).toBe(false)
    expect(userModel.declaredAvailable).toBe(false)
    expect(userModel.available).toBe(true)
    expect(userModel.effective.source).toBe('project-dsh')

    const mergedModel = pick(buildModelRows(snapshot, 'merged'), 'fast')
    expect(mergedModel.declaredAvailable).toBe(true)
    expect(mergedModel.available).toBe(true)

    // raw 停用在层空间仍是可筛选的异常，不因被 project 覆盖而消失。
    expect(userModel.hasIssues).toBe(true)
    expect(mergedModel.hasIssues).toBe(false)
  })
})

describe('别名池：存在性 / 顺序 / 停用 / 未到达', () => {
  function poolSnapshot(): ControlSnapshot {
    const project = layer(
      'project-dsh',
      [rawModel('fast', 'acme', 'chat'), rawModel('slow', 'acme', 'slow', { available: false }), rawModel('alt', 'acme', 'alt')],
      [
        rawAlias('mixed', ['missing', 'slow', 'fast', 'alt']),
        rawAlias('dangling', ['missing']),
        rawAlias('disabled', ['slow']),
        rawAlias('partial', ['fast', 'slow']),
      ],
    )
    return snapshotOf({
      models: [
        modelDefinition('fast', 'acme', 'chat'),
        modelDefinition('slow', 'acme', 'slow', { available: false }),
        modelDefinition('alt', 'acme', 'alt'),
      ],
      aliases: [
        aliasDefinition('mixed', ['missing', 'slow', 'fast', 'alt']),
        aliasDefinition('dangling', ['missing']),
        aliasDefinition('disabled', ['slow']),
        aliasDefinition('partial', ['fast', 'slow']),
      ],
      layers: [project],
    })
  }

  it('池按声明顺序求值：unknown → disabled → selected → not-reached', () => {
    const rows = buildAliasRows(poolSnapshot(), 'merged')
    const mixed = pick(rows, 'mixed')
    expect(mixed.pool.map((entry) => entry.name)).toEqual(['missing', 'slow', 'fast', 'alt'])
    expect(mixed.pool.map((entry) => entry.state)).toEqual(['unknown-model', 'disabled', 'selected', 'not-reached'])
    expect(mixed.target?.modelName).toBe('fast')
    expect(mixed.dangling).toBe(true)
    expect(mixed.disabled).toBe(false)
    expect(mixed.hasIssues).toBe(true)
  })

  it('悬空与停用各有自己的谓词；部分停用仍算问题', () => {
    const rows = buildAliasRows(poolSnapshot(), 'merged')
    const dangling = pick(rows, 'dangling')
    expect(dangling.target).toBeUndefined()
    expect(dangling.dangling).toBe(true)
    expect(dangling.disabled).toBe(false)

    const disabled = pick(rows, 'disabled')
    expect(disabled.target).toBeUndefined()
    expect(disabled.dangling).toBe(false)
    expect(disabled.disabled).toBe(true)

    const partial = pick(rows, 'partial')
    expect(partial.target?.modelName).toBe('fast')
    expect(partial.disabled).toBe(false)
    expect(partial.hasIssues).toBe(true)
  })
})

describe('组折叠与合成条目', () => {
  it('merged / project 行都读生效 available，并标出组折叠', () => {
    const project = layer(
      'project-dsh',
      [
        rawModel('g-fast', 'acme', 'fast', { modelGroup: 'g' }),
        rawModel('g-slow', 'acme', 'slow', { available: false, modelGroup: 'g' }),
      ],
      [rawAlias('g-alias', ['g-fast'])],
    )
    const snapshot = snapshotOf({
      models: [
        modelDefinition('g-fast', 'acme', 'fast', { available: false, modelGroup: 'g' }),
        modelDefinition('g-slow', 'acme', 'slow', { available: false, modelGroup: 'g' }),
      ],
      aliases: [aliasDefinition('g-alias', ['g-fast'])],
      layers: [project],
    })

    const merged = pick(buildModelRows(snapshot, 'merged'), 'g-fast')
    expect(merged.available).toBe(false)
    expect(merged.declaredAvailable).toBe(true)
    expect(merged.group).toBe('g')
    expect(merged.groupFolded).toBe(true)

    const projectRow = pick(buildModelRows(snapshot, 'project'), 'g-fast')
    expect(projectRow.available).toBe(false)
    expect(projectRow.declaredAvailable).toBe(true)
    expect(projectRow.groupFolded).toBe(true)

    const slowRow = pick(buildModelRows(snapshot, 'project'), 'g-slow')
    expect(slowRow.declaredAvailable).toBe(false)
    expect(slowRow.groupFolded).toBe(false)

    const aliasRow = pick(buildAliasRows(snapshot, 'merged'), 'g-alias')
    expect(aliasRow.pool[0]?.state).toBe('disabled')
    expect(aliasRow.target).toBeUndefined()
    expect(aliasRow.disabled).toBe(true)
    expect(aliasRow.hasIssues).toBe(true)
  })

  it('built-in / synthesized 只出现在 merged 空间且只读', () => {
    const snapshot = snapshotOf({
      models: [modelDefinition('dsh-default', 'acme', 'chat', { source: 'built-in', synthesized: true })],
      aliases: [aliasDefinition('dsh-default', ['dsh-default'], { source: 'built-in' })],
      layers: [layer('project-dsh'), layer('user-dsh')],
      agents: [agentDefinition('epsilon', ['dsh-default'])],
    })

    const mergedModels = buildModelRows(snapshot, 'merged')
    const synthesized = pick(mergedModels, 'dsh-default')
    expect(synthesized.key).toBe('model:merged:dsh-default')
    expect(synthesized.synthesized).toBe(true)
    expect(synthesized.readOnly).toBe(true)
    expect(synthesized.path).toBeUndefined()
    expect(synthesized.available).toBe(true)
    // 内置 / 合成条目没有层声明：声明值读作 undefined，不拿生效值顶替。
    expect(synthesized.declaredAvailable).toBeUndefined()
    expect(synthesized.groupFolded).toBe(false)
    expect(synthesized.hasIssues).toBe(false)

    const mergedAliases = buildAliasRows(snapshot, 'merged')
    const builtIn = pick(mergedAliases, 'dsh-default')
    expect(builtIn.key).toBe('alias:merged:dsh-default')
    expect(builtIn.readOnly).toBe(true)
    expect(builtIn.target?.modelName).toBe('dsh-default')
    expect(builtIn.users).toEqual(['epsilon'])

    expect(buildModelRows(snapshot, 'project')).toHaveLength(0)
    expect(buildAliasRows(snapshot, 'project')).toHaveLength(0)
    expect(buildModelRows(snapshot, 'user')).toHaveLength(0)
    expect(buildAliasRows(snapshot, 'user')).toHaveLength(0)
  })
})

describe('fan-in 按 provider/model 线路，不按条目名', () => {
  function routeSnapshot(): ControlSnapshot {
    const project = layer(
      'project-dsh',
      [rawModel('one', 'acme', 'chat'), rawModel('one-alt', 'acme', 'chat'), rawModel('slow', 'acme', 'slow')],
      [rawAlias('first', ['one']), rawAlias('second', ['one-alt']), rawAlias('third', ['slow'])],
    )
    return snapshotOf({
      models: [
        modelDefinition('one', 'acme', 'chat'),
        modelDefinition('one-alt', 'acme', 'chat'),
        modelDefinition('slow', 'acme', 'slow'),
      ],
      aliases: [
        aliasDefinition('first', ['one']),
        aliasDefinition('second', ['one-alt']),
        aliasDefinition('third', ['slow']),
        aliasDefinition('dsh-default', ['one'], { source: 'built-in' }),
      ],
      layers: [project],
      agents: [
        agentDefinition('alpha', ['first']),
        agentDefinition('beta', ['second']),
        agentDefinition('epsilon', ['dsh-default']),
      ],
    })
  }

  it('同一路线的不同条目名合并为一组 fan-in', () => {
    const models = buildModelRows(routeSnapshot(), 'merged')
    const one = pick(models, 'one')
    expect(one.aliases.map((alias) => alias.alias)).toEqual(['first', 'dsh-default'])
    expect(one.fanIn.map((alias) => alias.alias)).toEqual(['first', 'second'])
    expect(one.fanIn.map((alias) => alias.alias)).not.toContain('third')
    expect(one.fanIn.map((alias) => alias.alias)).not.toContain('dsh-default')

    const oneAlt = pick(models, 'one-alt')
    expect(oneAlt.aliases.map((alias) => alias.alias)).toEqual(['second'])
    expect(oneAlt.fanIn.map((alias) => alias.alias)).toEqual(['first', 'second'])
  })

  it('别名行的 fan-in 走生效路线，并排除 built-in 与自身', () => {
    const aliases = buildAliasRows(routeSnapshot(), 'merged')
    expect(pick(aliases, 'first').fanIn.map((alias) => alias.alias)).toEqual(['second'])
    expect(pick(aliases, 'first').fanIn.map((alias) => alias.alias)).not.toContain('dsh-default')
    expect(pick(aliases, 'second').fanIn.map((alias) => alias.alias)).toEqual(['first'])
  })

  it('触达 agent 经别名合并，按 agent 去重且不重跑链解析', () => {
    const one = pick(buildModelRows(routeSnapshot(), 'merged'), 'one')
    expect(one.reach).toEqual([
      { agent: 'alpha', via: ['first'] },
      { agent: 'beta', via: ['second'] },
      { agent: 'epsilon', via: ['dsh-default'] },
    ])
  })
})

describe('health 缺省未判定，存在时原样透传', () => {
  it('没有 health 输入时行与池都没有 health 字段', () => {
    const aliases = buildAliasRows(baseSnapshot(), 'merged')
    const primary = pick(aliases, 'primary')
    expect(primary.health).toBeUndefined()
    expect(primary.pool[0]?.health).toBeUndefined()
    expect(healthLabel(undefined)).toBe('未判定')
  })

  it('按 route 传入时原样透传，缺省行仍然未判定', () => {
    const aliases = buildAliasRows(baseSnapshot(), 'merged', {
      healthByRoute: { 'acme/chat': 'degraded', 'acme/slow': 'disabled' },
    })
    const primary = pick(aliases, 'primary')
    expect(primary.health).toBe('degraded')
    expect(primary.pool[0]?.health).toBe('degraded')
    expect(primary.pool[1]?.health).toBe('disabled')
    expect(healthLabel(primary.health)).toBe('降级')
    expect(healthLabel('active')).toBe('正常')
    expect(healthLabel('disabled')).toBe('已停用')

    const backup = pick(buildAliasRows(baseSnapshot(), 'merged', { healthByRoute: {} }), 'backup')
    expect(backup.health).toBeUndefined()
  })
})

describe('remapImpact 与影响面', () => {
  it('只按 modelOrder 命中别名统计 agent，不看 newTargets 数量', () => {
    const agents = baseSnapshot().agents
    expect(remapImpact('primary', [], agents)).toEqual(['alpha', 'gamma'])
    expect(remapImpact('primary', ['fast'], agents)).toEqual(['alpha', 'gamma'])
    expect(remapImpact('primary', ['fast', 'alt-fast', 'slow'], agents)).toEqual(['alpha', 'gamma'])
    expect(remapImpact('missing', [], agents)).toEqual([])
  })

  it('agentsUsingAlias 保留 agent 顺序，newTargets 形状不改变集合', () => {
    const agents = baseSnapshot().agents
    expect(agentsUsingAlias('backup', agents)).toEqual(['beta'])
    expect(remapImpact('legacy', ['fast'], agents)).toEqual(['gamma'])
  })
})

describe('唯一查询求值器', () => {
  const snapshot = baseSnapshot()
  const aliasRows = buildAliasRows(snapshot, 'merged')

  it('文本搜索覆盖名称、target、路线、path、使用者与层标签', () => {
    expect(evaluateRegistryQuery(aliasRows, { text: ' acme/chat ' }).map((row) => row.name)).toContain('primary')
    expect(evaluateRegistryQuery(aliasRows, { text: 'USER' }).map((row) => row.name)).toEqual(['backup'])
    expect(evaluateRegistryQuery(aliasRows, { text: 'gamma' }).map((row) => row.name)).toEqual(['legacy', 'primary'])
  })

  it('仅异常只看 hasIssues：别名的悬空 / 停用，模型的 available:false', () => {
    expect(evaluateRegistryQuery(aliasRows, { onlyIssues: true }).map((row) => row.name)).toEqual(['primary'])
    const models = buildModelRows(snapshot, 'merged')
    expect(evaluateRegistryQuery(models, { onlyIssues: true }).map((row) => row.name)).toEqual(['slow'])
  })

  it('排序轴与方向稳定，tie-break 按 name / key 升序', () => {
    const byName = evaluateRegistryQuery(aliasRows, {}).map((row) => row.name)
    expect(byName).toEqual(['alt', 'backup', 'dsh-default', 'legacy', 'pool', 'primary'])

    const byRefs = evaluateRegistryQuery(aliasRows, { sort: 'refs', direction: 'desc' }).map((row) => row.name)
    expect(byRefs.slice(0, 4)).toEqual(['primary', 'backup', 'dsh-default', 'legacy'])
    expect(byRefs.slice(4)).toEqual(['alt', 'pool'])

    const byLayer = evaluateRegistryQuery(aliasRows, { sort: 'layer', direction: 'desc' }).map((row) => row.source)
    expect(byLayer[0]).toBe('built-in')
    expect(byLayer.at(-1)).toBe('project-dsh')
  })

  it('过滤与排序不修改输入行，空查询保持数组副本', () => {
    const before = aliasRows.map((row) => row.key)
    const result = evaluateRegistryQuery(aliasRows, { text: 'backup', sort: 'refs' })
    expect(aliasRows.map((row) => row.key)).toEqual(before)
    expect(result).not.toBe(aliasRows)
    expect(result.map((row) => row.name)).toEqual(['backup'])
  })
})

describe('模块边界', () => {
  it('无 React / host / node IO import', () => {
    const source = readFileSync(new URL('../client-registry/registry-model.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from\s+['"]react['"]/)
    expect(source).not.toMatch(/from\s+['"]node:/)
    expect(source).not.toMatch(/from\s+['"]\.\.\/src\/(?!control\/index\.ts)/)
  })
})
