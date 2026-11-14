/**
 * 票 63 模型关联页的行为锚点：空间/类别切换、选中规则、空态、行标与详情壳。
 *
 * 组件测试用 react-dom/server 只断言可见输出（本仓没有 DOM 环境）；切换规则、
 * 聚焦落点与空态判定走纯函数，事件处理器本身由列表的 role/option 结构锚定。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  INITIAL_MODELS_PAGE_STATE,
  ModelsPageView,
} from '../client-registry/model-links.tsx'
import type { ModelsPageState } from '../client-registry/model-links.tsx'
import {
  effectiveSelection,
  emptyReasonOf,
  layerCountsOf,
  resolveFocusTarget,
  rowIssueTags,
  rowRoute,
  sourceTagClass,
  stepSelection,
} from '../client-registry/model-links.ts'
import { buildRegistryRows, evaluateRegistryQuery } from '../client-registry/registry-model.ts'

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

function modelDefinition(
  modelName: string,
  provider: string,
  model: string,
  options: {
    readonly source?: ModelDefinition['source'] | undefined
    readonly path?: string | undefined
    readonly available?: boolean | undefined
    readonly synthesized?: boolean | undefined
  } = {},
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
    ...(options.synthesized === true ? { synthesized: true } : {}),
  }
}

function aliasDefinition(
  alias: string,
  targets: readonly string[],
  options: { readonly source?: AliasDefinition['source'] | undefined } = {},
): AliasDefinition {
  const source = options.source ?? 'project-dsh'
  const path = source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH
  return { alias, targets, source, ...(path === undefined ? {} : { path }) }
}

function rawModel(modelName: string, provider: string, model: string, available = true): ModelDeclaration {
  return { modelName, provider, model, available }
}

function rawAlias(alias: string, targets: readonly string[]): AliasDeclaration {
  return { alias, targets }
}

function layer(
  source: AliasRegistryLayerSnapshot['source'],
  models: readonly ModelDeclaration[] = [],
  aliases: readonly AliasDeclaration[] = [],
): AliasRegistryLayerSnapshot {
  return { source, path: source === 'project-dsh' ? PROJECT_PATH : USER_PATH, models, aliases }
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

/** 双层、同名遮蔽、悬空别名、停用模型、内置合成条目一份齐。 */
function fullSnapshot(): ControlSnapshot {
  return snapshotOf({
    layers: [
      layer('project-dsh', [rawModel('fast', 'acme', 'chat'), rawModel('idle', 'acme', 'idle', false)], [
        rawAlias('smart', ['fast']),
        rawAlias('broken', ['ghost']),
        rawAlias('twin', ['fast']),
      ]),
      layer('user-dsh', [rawModel('fast', 'acme', 'chat-user'), rawModel('slow', 'acme', 'slow')], [
        rawAlias('smart', ['slow']),
        rawAlias('legacy', ['slow']),
      ]),
    ],
    models: [
      modelDefinition('fast', 'acme', 'chat'),
      modelDefinition('idle', 'acme', 'idle', { available: false }),
      modelDefinition('slow', 'acme', 'slow', { source: 'user-dsh' }),
      modelDefinition('dsh-default', 'deepseek', 'chat', { source: 'built-in', synthesized: true }),
    ],
    aliases: [
      aliasDefinition('smart', ['fast']),
      aliasDefinition('broken', ['ghost']),
      aliasDefinition('twin', ['fast']),
      aliasDefinition('legacy', ['slow'], { source: 'user-dsh' }),
      aliasDefinition('dsh-default', ['dsh-default'], { source: 'built-in' }),
    ],
    agents: [agentDefinition('reviewer', ['smart']), agentDefinition('legacy-user', ['legacy'])],
  })
}

function state(patch: Partial<ModelsPageState> = {}): ModelsPageState {
  return { ...INITIAL_MODELS_PAGE_STATE, ...patch }
}

function render(snapshot: ControlSnapshot, pageState: ModelsPageState): string {
  return renderToStaticMarkup(h(ModelsPageView, {
    snapshot,
    state: pageState,
    onState: () => {},
    onSelect: () => {},
  }))
}

function optionCount(html: string): number {
  return (html.match(/role="option"/g) ?? []).length
}

describe('切空间与切类别的选中规则', () => {
  const snapshot = fullSnapshot()
  const mergedAliases = buildRegistryRows(snapshot, 'merged', 'alias')
  const userAliases = buildRegistryRows(snapshot, 'user', 'alias')
  const projectAliases = buildRegistryRows(snapshot, 'project', 'alias')
  const mergedModels = buildRegistryRows(snapshot, 'merged', 'model')

  it('同名条目在目标空间仍存在时保留选中', () => {
    expect(effectiveSelection({ kind: 'alias', name: 'smart' }, userAliases, userAliases, 'alias')).toEqual({ kind: 'alias', name: 'smart' })
    expect(effectiveSelection({ kind: 'alias', name: 'smart' }, mergedAliases, mergedAliases, 'alias')).toEqual({ kind: 'alias', name: 'smart' })
  })

  it('没有可保留的选中时跟可见首行（排序后的第一条）', () => {
    const visible = evaluateRegistryQuery(mergedAliases, { sort: 'name' })
    expect(effectiveSelection(null, mergedAliases, visible, 'alias')?.name).toBe(visible[0]?.name)
  })

  it('目标不在新空间时跟到第一条', () => {
    expect(effectiveSelection({ kind: 'alias', name: 'smart' }, projectAliases, projectAliases, 'alias')?.name).toBe(projectAliases[0]?.name)
    expect(effectiveSelection({ kind: 'alias', name: 'legacy' }, projectAliases, projectAliases, 'alias')?.name).toBe(projectAliases[0]?.name)
  })

  it('切类别跟到新类别的第一条', () => {
    expect(effectiveSelection({ kind: 'alias', name: 'fast' }, mergedModels, mergedModels, 'model')?.name).toBe(mergedModels[0]?.name)
  })

  it('目标空间为空才没有选中', () => {
    expect(effectiveSelection({ kind: 'alias', name: 'smart' }, [], [], 'alias')).toBeNull()
  })

  it('上下键步进与边界', () => {
    const first = mergedAliases[0]
    const last = mergedAliases[mergedAliases.length - 1]
    if (first === undefined || last === undefined) throw new Error('this fixture needs at least two aliases')
    const fromFirst = stepSelection(mergedAliases, first?.key ?? null, 1)
    expect(fromFirst?.name).toBe(mergedAliases[1]?.name)
    expect(stepSelection(mergedAliases, last?.key ?? null, 1)?.name).toBe(last?.name)
    expect(stepSelection(mergedAliases, null, -1)?.name).toBe(last?.name)
    expect(stepSelection(mergedAliases, 'unknown', 1)?.name).toBe(first?.name)
    expect(stepSelection([], null, 1)).toBeNull()
  })
})

describe('跨页聚焦落点', () => {
  const snapshot = fullSnapshot()

  it('当前空间有目标就不切空间', () => {
    expect(resolveFocusTarget({ kind: 'alias', name: 'legacy' }, snapshot, 'user')).toEqual({ space: 'user', kind: 'alias', name: 'legacy' })
  })

  it('当前空间没有、合并空间有 ⇒ 切合并', () => {
    expect(resolveFocusTarget({ kind: 'alias', name: 'legacy' }, snapshot, 'project')).toEqual({ space: 'merged', kind: 'alias', name: 'legacy' })
    expect(resolveFocusTarget({ kind: 'model', name: 'slow' }, snapshot, 'project')).toEqual({ space: 'merged', kind: 'model', name: 'slow' })
  })

  it('合并空间也没有 ⇒ 不消费（等下一份快照）', () => {
    expect(resolveFocusTarget({ kind: 'alias', name: 'ghost' }, snapshot, 'merged')).toBeNull()
    expect(resolveFocusTarget({ kind: 'agent', name: 'reviewer' }, snapshot, 'merged')).toBeNull()
  })
})

describe('空态判定', () => {
  const snapshot = fullSnapshot()
  const projectLayerEmpty = snapshotOf({
    projectRoot: '/work',
    layers: [layer('project-dsh'), layer('user-dsh', [rawModel('slow', 'acme', 'slow')], [rawAlias('legacy', ['slow'])])],
    models: [modelDefinition('slow', 'acme', 'slow', { source: 'user-dsh' })],
    aliases: [aliasDefinition('legacy', ['slow'], { source: 'user-dsh' })],
  })
  const projectLayerMissing = snapshotOf({
    projectRoot: '/work',
    layers: [layer('user-dsh', [rawModel('slow', 'acme', 'slow')])],
    models: [modelDefinition('slow', 'acme', 'slow', { source: 'user-dsh' })],
    aliases: [],
  })
  const userGlobal = snapshotOf({ projectRoot: null, layers: [layer('user-dsh')] })

  it('有可见行时没有空态；全量行在但筛选空 ⇒ 无匹配', () => {
    const aliases = buildRegistryRows(snapshot, 'merged', 'alias')
    expect(emptyReasonOf(snapshot, 'merged', 'alias', aliases, aliases.slice(0, 1))).toBeNull()
    expect(emptyReasonOf(snapshot, 'merged', 'alias', aliases, [])).toBe('filtered')
  })

  it('工作区在用户全局不可用', () => {
    expect(emptyReasonOf(userGlobal, 'project', 'alias', [], [])).toBe('space-unavailable')
  })

  it('层文件缺失与层为空', () => {
    expect(emptyReasonOf(projectLayerMissing, 'project', 'alias', [], [])).toBe('layer-missing')
    expect(emptyReasonOf(projectLayerEmpty, 'project', 'alias', [], [])).toBe('layer-empty')
  })

  it('全局没有任何条目', () => {
    expect(emptyReasonOf(snapshotOf({ models: [], aliases: [] }), 'merged', 'model', [], [])).toBe('registry-empty')
  })

  it('分层计数来自宿主投影', () => {
    expect(layerCountsOf(snapshot)).toEqual({
      mergedModels: 4,
      mergedAliases: 5,
      projectModels: 2,
      projectAliases: 3,
      userModels: 2,
      userAliases: 2,
      projectAvailable: true,
    })
  })
})

describe('行展示词', () => {
  const snapshot = fullSnapshot()
  const aliases = buildRegistryRows(snapshot, 'merged', 'alias')
  const smart = aliases.find((row) => row.name === 'smart')
  const broken = aliases.find((row) => row.name === 'broken')
  const models = buildRegistryRows(snapshot, 'merged', 'model')
  const idle = models.find((row) => row.name === 'idle')

  it('层标签类与路线来自行', () => {
    expect(smart?.source).toBe('project-dsh')
    expect(sourceTagClass('project-dsh')).toBe('tag-workspace')
    expect(sourceTagClass('user-dsh')).toBe('tag-user')
    expect(sourceTagClass('built-in')).toBe('tag-bundled')
    expect(rowRoute(smart as never)).toBe('acme/chat')
  })

  it('悬空与停用各有一条可见状态词', () => {
    expect(rowIssueTags(broken as never).map((tag) => tag.text)).toContain('悬空')
    expect(rowIssueTags(idle as never).map((tag) => tag.text)).toContain('停用')
  })
})

describe('模型关联页静态输出', () => {
  const snapshot = fullSnapshot()

  it('合并空间默认按别名列出，计数是可见/全部，行含目标、路线、计数、层与遮蔽', () => {
    const html = render(snapshot, state())
    expect(html).toContain('data-registry-view="models"')
    expect(html).toContain('role="listbox"')
    expect(optionCount(html)).toBe(5)
    expect(html).toContain('5/5')
    expect(html).toContain('smart')
    expect(html).toContain('acme/chat')
    expect(html).toContain('Agent ×1')
    expect(html).toContain('project · .dsh')
    expect(html).toContain('遮蔽 1')
    expect(html).toContain('broken')
    expect(html).toContain('悬空')
    expect(html).toContain('dsh-default')
    expect(html).toContain('内置 · 只读')
    expect(html).toContain('（内置，无文件）')
    expect(html).toContain('关闭详情')
  })

  it('工作区空间只列本层行并显示「覆盖」', () => {
    const html = render(snapshot, state({ space: 'project' }))
    expect(optionCount(html)).toBe(3)
    expect(html).toContain('覆盖 1')
    expect(html).toContain('twin')
    expect(html).not.toContain('legacy')
  })

  it('用户空间显示「被覆盖」，且不出现工作区专属行', () => {
    const html = render(snapshot, state({ space: 'user' }))
    expect(optionCount(html)).toBe(2)
    expect(html).toContain('被覆盖')
    expect(html).toContain('legacy')
    expect(html).not.toContain('broken')
  })

  it('模型条目类别列出路线与指向别名计数', () => {
    const html = render(snapshot, state({ kind: 'model' }))
    expect(optionCount(html)).toBe(4)
    expect(html).toContain('acme/idle')
    expect(html).toContain('别名 ×2')
    expect(html).toContain('停用')
  })

  it('用户全局禁用工作区并给出一句说明', () => {
    const global = snapshotOf({ projectRoot: null, layers: [layer('user-dsh')] })
    const html = render(global, state())
    expect(html).toMatch(/disabled[^>]*>工作区<\/button>/)
    expect(html).toContain('当前为用户全局（无项目根）：工作区层不可用。')
    expect(html).toContain('id="models-space-note"')
  })

  it('筛选无命中显示清除按钮，计数归零', () => {
    const html = render(snapshot, state({ text: 'zzz' }))
    expect(html).toContain('0/5')
    expect(html).toContain('没有匹配的别名')
    expect(html).toContain('清除筛选')
  })

  it('选中行被筛选掉时，可见首行仍是可 Tab 的 roving stop', () => {
    const html = render(snapshot, state({ text: 'deepseek', selected: { kind: 'alias', name: 'smart' } }))
    expect(html).toContain('1/5')
    const at = html.indexOf('data-model-row="alias:merged:dsh-default"')
    const row = html.slice(html.lastIndexOf('<button', at))
    const tag = row.slice(0, row.indexOf('>'))
    expect(tag).toContain('tabindex="0"')
    expect(tag).toContain('aria-selected="false"')
  })

  it('层缺失 / 层为空 / 全局为空各有自己的空态', () => {
    const missing = snapshotOf({ projectRoot: '/work', layers: [layer('user-dsh', [rawModel('slow', 'acme', 'slow')])], models: [modelDefinition('slow', 'acme', 'slow', { source: 'user-dsh' })] })
    expect(render(missing, state({ space: 'project' }))).toContain('当前空间没有 registry 层')

    const emptyLayer = snapshotOf({ projectRoot: '/work', layers: [layer('project-dsh'), layer('user-dsh', [rawModel('slow', 'acme', 'slow')], [rawAlias('legacy', ['slow'])])], models: [modelDefinition('slow', 'acme', 'slow', { source: 'user-dsh' })], aliases: [aliasDefinition('legacy', ['slow'], { source: 'user-dsh' })] })
    expect(render(emptyLayer, state({ space: 'project' }))).toContain('该层还没有声明别名')

    expect(render(snapshotOf({}), state())).toContain('还没有任何别名')
  })

  it('关闭详情后列表占满，且不渲染分隔条与详情壳', () => {
    const html = render(snapshot, state({ detailOpen: false }))
    expect(html).toContain('detail-closed')
    expect(html).not.toContain('model-detail')
    expect(html).not.toContain('pane-splitter')
  })

  it('详情壳显示选中条目的身份与层事实', () => {
    const html = render(snapshot, state({ selected: { kind: 'alias', name: 'smart' } }))
    const detail = html.slice(html.indexOf('class="model-detail"'))
    expect(detail).toContain('smart')
    expect(detail).toContain('合并 · project · .dsh')
    expect(detail).toContain('目标')
    expect(detail).toContain('acme/chat')
  })
})
