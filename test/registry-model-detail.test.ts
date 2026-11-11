/**
 * 票 66 模型详情与字段的行为锚点：可用性事实与组折叠触发、引用 / 可达、
 * 删除门禁（接管 / 引用列表 / 确认）、新增校验与写结果词表。
 *
 * 本仓没有 DOM 环境：组件测试只断言 react-dom/server 的可见输出；写动作
 * 以 data 属性与文案锚定结构，真正的落盘归页面写通道（票 62）。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  INITIAL_MODELS_PAGE_STATE,
  ModelsPageView,
} from '../client-registry/model-links.tsx'
import type { ModelsPageState, ModelsPageViewProps } from '../client-registry/model-links.tsx'
import {
  EMPTY_ADD_MODEL_DRAFT,
  addModelCheckOf,
  addModelTargetOf,
  availabilityFactsOf,
  buildAddModelEdit,
  deleteGateOf,
  deleteModelEditOf,
  fanInOthersOf,
  groupTriggerNamesOf,
  modelPromptOf,
  setAvailableEditOf,
  writeHeadlineOf,
  writeLinesOf,
  writeToneOf,
} from '../client-registry/model-detail.ts'
import { buildRegistryRows } from '../client-registry/registry-model.ts'

import type { ModelRow } from '../client-registry/registry-model.ts'
import type { RegistryWriteOutcome } from '../src/dsh/client/chunk-contracts.ts'
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
  const path = options.path ?? (source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH)
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

function rawModel(
  modelName: string,
  provider: string,
  model: string,
  options: { readonly available?: boolean | undefined; readonly modelGroup?: string | undefined; readonly sysPrompt?: string | undefined } = {},
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

function aliasDefinition(
  alias: string,
  targets: readonly string[],
  source: AliasDefinition['source'] = 'project-dsh',
): AliasDefinition {
  return {
    alias,
    targets,
    source,
    ...(source === 'built-in' ? {} : { path: source === 'project-dsh' ? PROJECT_PATH : USER_PATH }),
  }
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

function agentDefinition(agentName: string, modelOrder: readonly string[]): AgentDefinition {
  return {
    agentName,
    name: agentName,
    description: '',
    body: '',
    modelOrder,
    source: 'project-agents',
    origin: 'user',
    providerId: 'project-agents',
    extra: {},
    path: '/work/.agents/' + agentName + '/agent.md',
  }
}

function snapshotOf(input: {
  readonly models?: readonly ModelDefinition[] | undefined
  readonly aliases?: readonly AliasDefinition[] | undefined
  readonly layers?: readonly AliasRegistryLayerSnapshot[] | undefined
  readonly agents?: readonly AgentDefinition[] | undefined
  readonly projectRoot?: string | null | undefined
}): ControlSnapshot {
  const projectRoot = input.projectRoot === undefined ? '/work' : input.projectRoot
  return {
    models: input.models ?? [],
    aliases: input.aliases ?? [],
    registryLayers: input.layers ?? [],
    agents: input.agents ?? [],
    agentDiagnostics: [],
    aliasDiagnostics: [],
    findings: [],
    assemblies: {},
    scope: { cwd: projectRoot, projectRoot },
  }
}

/**
 * 一份覆盖全部门禁形状的快照：
 * - fast 被 smart / twin 指向，工作区层赢、用户层同名接管；
 * - alt-fast 与 fast 同线路，供 fan-in 去重；
 * - gpu-a / gpu-b 同组，前者声明 false 把整组折成停用（gpu-b 声明 true）；
 * - orphan 只在用户层，被两个别名指向且没有下层；
 * - dsh-default 内置合成，只读。
 */
function fixture(projectRoot: string | null = '/work'): ControlSnapshot {
  return snapshotOf({
    projectRoot,
    layers: [
      layer(
        'project-dsh',
        [
          rawModel('fast', 'acme', 'chat', { sysPrompt: 'Be terse.' }),
          rawModel('alt-fast', 'acme', 'chat'),
          rawModel('idle', 'acme', 'idle', { available: false }),
          rawModel('gpu-a', 'acme', 'gpu', { modelGroup: 'gpu', available: false }),
          rawModel('gpu-b', 'acme', 'gpu2', { modelGroup: 'gpu' }),
        ],
        [
          rawAlias('smart', ['fast']),
          rawAlias('twin', ['fast']),
          rawAlias('alt', ['alt-fast']),
          rawAlias('orphan-alias', ['orphan']),
        ],
      ),
      layer(
        'user-dsh',
        [rawModel('fast', 'acme', 'chat-user'), rawModel('orphan', 'acme', 'orphan')],
        [rawAlias('legacy', ['orphan'])],
      ),
    ],
    models: [
      modelDefinition('fast', 'acme', 'chat', { sysPrompt: 'Be terse.' }),
      modelDefinition('alt-fast', 'acme', 'chat'),
      modelDefinition('idle', 'acme', 'idle', { available: false }),
      modelDefinition('gpu-a', 'acme', 'gpu', { available: false, modelGroup: 'gpu' }),
      modelDefinition('gpu-b', 'acme', 'gpu2', { available: false, modelGroup: 'gpu' }),
      modelDefinition('orphan', 'acme', 'orphan', { source: 'user-dsh' }),
      modelDefinition('dsh-default', 'deepseek', 'chat', { source: 'built-in', synthesized: true }),
    ],
    aliases: [
      aliasDefinition('smart', ['fast']),
      aliasDefinition('twin', ['fast']),
      aliasDefinition('alt', ['alt-fast']),
      aliasDefinition('orphan-alias', ['orphan']),
      aliasDefinition('legacy', ['orphan'], 'user-dsh'),
      aliasDefinition('dsh-default', ['dsh-default'], 'built-in'),
    ],
    agents: [
      agentDefinition('reviewer', ['smart']),
      agentDefinition('twin-user', ['twin']),
      agentDefinition('alt-user', ['alt']),
      agentDefinition('orphan-user', ['orphan-alias']),
      agentDefinition('legacy-user', ['legacy']),
    ],
  })
}

function modelRow(snapshot: ControlSnapshot, space: 'merged' | 'project' | 'user', name: string): ModelRow {
  const found = buildRegistryRows(snapshot, space, 'model').find((row) => row.name === name)
  if (found === undefined || found.kind !== 'model') throw new Error('fixture is missing model ' + name + ' in ' + space)
  return found
}

function state(patch: Partial<ModelsPageState> = {}): ModelsPageState {
  return { ...INITIAL_MODELS_PAGE_STATE, ...patch }
}

function render(
  snapshot: ControlSnapshot,
  patch: Partial<ModelsPageState> = {},
  extra: Partial<ModelsPageViewProps> = {},
): string {
  return renderToStaticMarkup(h(ModelsPageView, {
    snapshot,
    state: state(patch),
    onState: () => {},
    onSelect: () => {},
    ...extra,
  }))
}

function detailOf(html: string): string {
  const at = html.indexOf('class="model-detail"')
  return at < 0 ? '' : html.slice(at)
}

function tagAround(html: string, marker: string): string {
  const at = html.indexOf(marker)
  if (at < 0) return ''
  const start = html.lastIndexOf('<', at)
  const end = html.indexOf('>', at)
  return html.slice(start, end + 1)
}

const WRITE_EXTRAS: Partial<ModelsPageViewProps> = {
  onToggleAvailable: () => {},
  onDeleteModel: () => {},
  onAddModel: () => {},
}

describe('可用性事实与组折叠', () => {
  const snapshot = fixture()

  it('合并行取赢家声明；生效值来自合并快照', () => {
    const row = modelRow(snapshot, 'merged', 'fast')
    const facts = availabilityFactsOf(snapshot, row)
    expect(facts.declared).toBe(true)
    expect(facts.effective).toBe(true)
    expect(facts.declaredLayer).toBe('project-dsh')
    expect(facts.declaredPath).toBe(PROJECT_PATH)
    expect(facts.effectiveLayer).toBe('project-dsh')
    expect(facts.editable).toBe(true)
    expect(facts.folded).toBe(false)
    expect(facts.triggers).toEqual([])
  })

  it('组内一条 false 折叠整组：声明 true 的组员被折成停用并注明触发条目', () => {
    const folded = modelRow(snapshot, 'merged', 'gpu-b')
    const facts = availabilityFactsOf(snapshot, folded)
    expect(facts.declared).toBe(true)
    expect(facts.effective).toBe(false)
    expect(facts.folded).toBe(true)
    expect(facts.triggers).toEqual(['gpu-a'])
    expect(groupTriggerNamesOf(snapshot, folded)).toEqual(['gpu-a'])

    const trigger = modelRow(snapshot, 'merged', 'gpu-a')
    expect(availabilityFactsOf(snapshot, trigger).folded).toBe(false)
  })

  it('被高层覆盖的层行：声明层与生效层分开，开关不可编辑', () => {
    const row = modelRow(snapshot, 'user', 'fast')
    const facts = availabilityFactsOf(snapshot, row)
    expect(facts.declared).toBe(true)
    expect(facts.declaredLayer).toBe('user-dsh')
    expect(facts.effectiveLayer).toBe('project-dsh')
    expect(facts.effectivePath).toBe(PROJECT_PATH)
    expect(facts.editable).toBe(false)
  })

  it('内置合成为只读；模板缺省值是真实生效值', () => {
    const row = modelRow(snapshot, 'merged', 'dsh-default')
    const facts = availabilityFactsOf(snapshot, row)
    expect(facts.readOnly).toBe(true)
    expect(facts.editable).toBe(false)

    const idle = modelRow(snapshot, 'merged', 'idle')
    expect(availabilityFactsOf(snapshot, idle).declared).toBe(false)
  })
})

describe('引用列表、fan-in 与可达', () => {
  const snapshot = fixture()

  it('fan-in 去掉已经计入「指向本条目的别名」的那些', () => {
    const fast = modelRow(snapshot, 'merged', 'fast')
    expect(fast.aliases.map((alias) => alias.alias)).toEqual(['smart', 'twin'])
    expect(fanInOthersOf(fast).map((alias) => alias.alias)).toEqual(['alt'])
  })

  it('触达 agent 合并别名旁路，经路线的别名也算', () => {
    const fast = modelRow(snapshot, 'merged', 'fast')
    expect(fast.reach.map((entry) => entry.agent)).toEqual(['reviewer', 'twin-user', 'alt-user'])
    expect(fast.reach.map((entry) => entry.via.join(','))).toEqual(['smart', 'twin', 'alt'])
  })

  it('sysPrompt 预览取运行时生效值', () => {
    expect(modelPromptOf(modelRow(snapshot, 'merged', 'fast'))).toBe('Be terse.')
    expect(modelPromptOf(modelRow(snapshot, 'merged', 'alt-fast'))).toBeUndefined()
  })
})

describe('删除门禁', () => {
  const snapshot = fixture()

  it('有引用且有下层同名声明：允许并给出接管层', () => {
    const row = modelRow(snapshot, 'merged', 'fast')
    const gate = deleteGateOf(row)
    expect(gate.allowed).toBe(true)
    expect(gate.needsConfirm).toBe(true)
    expect(gate.refs.map((alias) => alias.alias)).toEqual(['smart', 'twin'])
    expect(gate.takeover).toEqual({ source: 'user-dsh', path: USER_PATH })
    expect(gate.file).toBe(PROJECT_PATH)
  })

  it('有引用但没有下层：拒绝，改列引用', () => {
    const row = modelRow(snapshot, 'merged', 'orphan')
    const gate = deleteGateOf(row)
    expect(gate.allowed).toBe(false)
    expect(gate.block).toBe('referenced')
    expect(gate.refs.map((alias) => alias.alias)).toEqual(['orphan-alias', 'legacy'])
    expect(gate.reason).toContain('悬空')
  })

  it('无引用：允许但要求二次确认', () => {
    const row = modelRow(snapshot, 'merged', 'idle')
    expect(deleteGateOf(row).allowed).toBe(true)
    expect(deleteGateOf(row).needsConfirm).toBe(true)
  })

  it('内置合成只读；被高层覆盖的层行不能在层空间删除', () => {
    const builtIn = modelRow(snapshot, 'merged', 'dsh-default')
    expect(deleteGateOf(builtIn)).toMatchObject({ allowed: false, block: 'read-only' })
    expect(deleteGateOf(builtIn).reason).toContain('合成条目只读')

    const covered = modelRow(snapshot, 'user', 'fast')
    const gate = deleteGateOf(covered)
    expect(gate.allowed).toBe(false)
    expect(gate.block).toBe('covered')
    expect(gate.reason).toContain('接管')
  })

  it('编辑载荷只带名字，服务端按生效声明解析文件', () => {
    expect(deleteModelEditOf(modelRow(snapshot, 'merged', 'idle'))).toEqual({ kind: 'deleteModel', modelName: 'idle' })
    expect(setAvailableEditOf(modelRow(snapshot, 'merged', 'fast'), false)).toEqual({ kind: 'setAvailable', modelName: 'fast', available: false })
  })
})

describe('新增模型条目', () => {
  const snapshot = fixture()

  it('合并视图落工作区层，用户空间落用户层', () => {
    expect(addModelTargetOf(snapshot, 'merged')).toEqual({ target: { source: 'project-dsh', label: 'project · .dsh', path: PROJECT_PATH } })
    expect(addModelTargetOf(snapshot, 'project').target?.source).toBe('project-dsh')
    expect(addModelTargetOf(snapshot, 'user').target?.source).toBe('user-dsh')
  })

  it('重名、空字段与非法字符都在提交前拦下', () => {
    const duplicate = addModelCheckOf(snapshot, 'merged', { ...EMPTY_ADD_MODEL_DRAFT, name: 'fast', provider: 'acme', model: 'chat' })
    expect(duplicate.canSubmit).toBe(false)
    expect(duplicate.problems.map((problem) => problem.field)).toContain('name')
    expect(duplicate.problems.map((problem) => problem.message).join('\n')).toContain('已有同名模型条目')

    const empty = addModelCheckOf(snapshot, 'merged', EMPTY_ADD_MODEL_DRAFT)
    expect(empty.problems.map((problem) => problem.field)).toEqual(['name', 'provider', 'model'])
    expect(empty.canSubmit).toBe(false)

    const invalid = addModelCheckOf(snapshot, 'merged', { ...EMPTY_ADD_MODEL_DRAFT, name: 'bad name', provider: 'acme', model: 'chat' })
    expect(invalid.canSubmit).toBe(false)
  })

  it('合法草稿可以提交，载荷按目标层与去空白构造', () => {
    const draft = { name: 'new-model', provider: ' acme ', model: ' chat ', sysPrompt: '', available: true }
    const check = addModelCheckOf(snapshot, 'merged', draft)
    expect(check.canSubmit).toBe(true)
    expect(check.target?.source).toBe('project-dsh')
    const edit = buildAddModelEdit(check.target as never, draft)
    expect(edit).toMatchObject({ kind: 'addModel', modelName: 'new-model', provider: 'acme', model: 'chat', source: 'project-dsh' })
    expect('sysPrompt' in edit).toBe(false)

    const userCheck = addModelCheckOf(snapshot, 'user', draft)
    expect(buildAddModelEdit(userCheck.target as never, draft)).toMatchObject({ source: 'user-dsh' })
  })

  it('没有项目根时合并 / 工作区空间禁写并说明', () => {
    const global = snapshotOf({ projectRoot: null, layers: [layer('user-dsh')] })
    expect(addModelTargetOf(global, 'merged').problem?.message).toContain('没有项目根')
    expect(addModelTargetOf(global, 'project').problem?.message).toContain('没有项目根')
    expect(addModelCheckOf(global, 'merged', { ...EMPTY_ADD_MODEL_DRAFT, name: 'x', provider: 'p', model: 'm' }).canSubmit).toBe(false)
  })
})

describe('写结果词表', () => {
  it('成功行给出文件与回读结果', () => {
    const outcome: RegistryWriteOutcome = {
      status: 'ok',
      rows: [{ ok: true, file: PROJECT_PATH, editIndex: 0 }],
      changedCount: 1,
    }
    expect(writeHeadlineOf(outcome)).toBe('已写入（1 笔）')
    expect(writeToneOf(outcome)).toBe('ok')
    expect(writeLinesOf(outcome).map((line) => line.text)).toEqual(['已写入 ' + PROJECT_PATH, '写后快照已回读。'])
  })

  it('失败 / 部分 / 回读失败与 busy 各有词', () => {
    const failed: RegistryWriteOutcome = {
      status: 'failed',
      rows: [{ ok: false, file: undefined, code: 'invalid-edit', message: 'boom', editIndex: 0 }],
      changedCount: 0,
    }
    expect(writeHeadlineOf(failed)).toBe('写入失败')
    expect(writeToneOf(failed)).toBe('err')
    expect(writeLinesOf(failed).map((line) => line.text).join('\n')).toContain('（invalid-edit）：boom')

    const reloadFailed: RegistryWriteOutcome = {
      status: 'partial',
      rows: [{ ok: true, file: PROJECT_PATH, editIndex: 0 }, { ok: false, file: undefined, code: 'io-error', message: 'disk', editIndex: 1 }],
      changedCount: 1,
      reloadError: 'state failed',
    }
    expect(writeToneOf(reloadFailed)).toBe('err')
    expect(writeLinesOf(reloadFailed).map((line) => line.text).join('\n')).toContain('回读失败：state failed')

    const busy: RegistryWriteOutcome = { status: 'busy', rows: [], changedCount: 0 }
    expect(writeHeadlineOf(busy)).toBe('写入未发送')
    expect(writeToneOf(busy)).toBe('warn')
  })
})

describe('模型详情静态输出', () => {
  const snapshot = fixture()

  it('可用开关、声明 / 生效值、引用、fan-in、触达、sysPrompt 与删除入口都在', () => {
    const detail = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'fast' } }, WRITE_EXTRAS))
    expect(detail).toContain('可用开关（available）')
    expect(detail).toContain('data-model-available="fast"')
    expect(detail).toContain('生效值')
    expect(detail).toContain('声明值')
    expect(detail).toContain('指向本条目的别名（×2）')
    expect(detail).toContain('同线路别名（fan-in）')
    expect(detail).toContain('alt')
    expect(detail).toContain('触达 Agent（×3）')
    expect(detail).toContain('在智能体列表定位 reviewer')
    expect(detail).toContain('经 smart')
    expect(detail).toContain('系统提示词（sysPrompt）')
    expect(detail).toContain('Be terse.')
    expect(detail).toContain('data-model-prompt="fast"')
    expect(detail).toContain('data-jump="prompt"')
    expect(detail).toContain('在系统提示词页定位模型条目 fast')
    expect(detail).toContain('删除条目')
    expect(detail).toContain('删除后由下层接管：user · ~/.dsh')
    expect(detail).toContain('data-model-delete="fast"')
    // 票 64 的别名详情仍是独立正文，不与模型字段混在一起。
    expect(detail).not.toContain('目标池')
    expect(detail).not.toContain('解析链诊断')
  })

  it('组折叠时注明触发条目，并说明整组开关归票 67', () => {
    const detail = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'gpu-b' } }, WRITE_EXTRAS))
    expect(detail).toContain('组级停用')
    expect(detail).toContain('gpu-a')
    expect(detail).toContain('整组开关归票 67')
    expect(detail).toContain('声明值')
    expect(detail).toContain('生效值')
  })

  it('被覆盖的层行开关禁用，并说明去合并视图编辑', () => {
    const detail = detailOf(render(snapshot, { space: 'user', kind: 'model', selected: { kind: 'model', name: 'fast' } }, WRITE_EXTRAS))
    expect(tagAround(detail, 'data-model-available="fast"')).toContain('disabled')
    expect(detail).toContain('本条声明被 project · .dsh 接管')
    expect(detail).toContain('切到合并视图')
  })

  it('内置合成条目只读：无 path、无删除按钮、开关禁用', () => {
    const detail = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'dsh-default' } }, WRITE_EXTRAS))
    expect(detail).toContain('（合成，无文件）')
    expect(detail).toContain('内置 / 合成条目只读')
    expect(tagAround(detail, 'data-model-available="dsh-default"')).toContain('disabled')
    expect(detail).not.toContain('data-model-delete="dsh-default"')
  })

  it('有引用无下层：换成引用列表，不提供删除按钮', () => {
    const detail = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'orphan' } }, WRITE_EXTRAS))
    expect(detail).toContain('引用列表（别名 ×2）')
    expect(detail).toContain('orphan-alias')
    expect(detail).toContain('legacy')
    expect(detail).toContain('会让别名悬空')
    expect(detail).not.toContain('data-model-delete="orphan"')
  })

  it('删除确认面板显示接管层、引用列表与写入文件', () => {
    const detail = detailOf(render(snapshot, {
      kind: 'model',
      selected: { kind: 'model', name: 'fast' },
      deleteConfirm: true,
    }, WRITE_EXTRAS))
    expect(detail).toContain('确认删除 fast？')
    expect(detail).toContain('data-model-delete-confirm="fast"')
    expect(detail).toContain('引用列表：smart、twin')
    expect(detail).toContain('写入文件：' + PROJECT_PATH)
  })

  it('新增表单：目标层、字段、重名错误与提交禁用', () => {
    const detail = detailOf(render(snapshot, {
      kind: 'model',
      addOpen: true,
      addDraft: { ...EMPTY_ADD_MODEL_DRAFT, name: 'fast' },
    }, WRITE_EXTRAS))
    expect(detail).toContain('新增模型条目')
    expect(detail).toContain('写入 project · .dsh · ' + PROJECT_PATH)
    expect(detail).toContain('已有同名模型条目「fast」')
    expect(detail).toContain('模型条目名')
    expect(detail).toContain('provider')
    expect(detail).toContain('sysPrompt')
    expect(detail).toContain('available（默认启用）')
    expect(tagAround(detail, 'data-model-add-submit="fast"')).toContain('disabled')

    const valid = detailOf(render(snapshot, {
      kind: 'model',
      addOpen: true,
      addDraft: { name: 'new-model', provider: 'acme', model: 'chat', sysPrompt: '', available: true },
    }, WRITE_EXTRAS))
    expect(tagAround(valid, 'data-model-add-submit="new-model"')).not.toContain('disabled')
  })

  it('没有项目根时新增表单给出禁写说明', () => {
    const global = snapshotOf({ projectRoot: null, layers: [layer('user-dsh')] })
    const detail = detailOf(render(global, {
      kind: 'model',
      addOpen: true,
      addDraft: { ...EMPTY_ADD_MODEL_DRAFT, name: 'x' },
    }, WRITE_EXTRAS))
    expect(detail).toContain('当前没有项目根')
    expect(detail).toContain('写入不可用')
  })

  it('写结果反馈按词表渲染成功 / 失败 / 回读失败', () => {
    const ok = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'fast' } }, {
      write: {
        status: 'done',
        outcome: { status: 'ok', rows: [{ ok: true, file: PROJECT_PATH, editIndex: 0 }], changedCount: 1 },
      },
    }))
    expect(ok).toContain('已写入（1 笔）')
    expect(ok).toContain('data-model-write="ok"')
    expect(ok).toContain('写后快照已回读。')

    const failed = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'fast' } }, {
      write: {
        status: 'done',
        outcome: { status: 'failed', rows: [{ ok: false, file: undefined, code: 'read-only', message: 'nope', editIndex: 0 }], changedCount: 0 },
      },
    }))
    expect(failed).toContain('data-model-write="err"')
    expect(failed).toContain('（read-only）：nope')
    expect(failed).toContain('role="alert"')
  })
})
