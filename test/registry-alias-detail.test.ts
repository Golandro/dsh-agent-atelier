/**
 * 票 64 别名详情与影响预览的行为锚点：池顺序与分色、解析链诊断（按需读面）、
 * 使用者 / fan-in、重映射影响预览与复制/跳转入口。
 *
 * 本仓没有 DOM 环境：组件测试只断言 react-dom/server 的可见输出；事件入口
 * 以 aria-label / data-jump 结构锚定，链与影响面走纯函数。
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
  activeRemapOption,
  aliasCandidatesOf,
  aliasStepOf,
  aliasWinnerCandidate,
  candidateForPool,
  candidateRouteLabel,
  candidateSkipText,
  chainForAlias,
  chainSkipLabel,
  chainVerdictOf,
  effortSourceLabel,
  poolHealthLabel,
  poolStateLabel,
  poolStateTagClass,
  healthTagClass,
  remapOptionsOf,
  remapPreviewOf,
} from '../client-registry/alias-detail.ts'
import { buildRegistryRows } from '../client-registry/registry-model.ts'

import type { AliasChainReport, AliasChainState, AliasCopyStatus } from '../client-registry/alias-detail.ts'
import type { AliasRow } from '../client-registry/registry-model.ts'
import type { AgentChainReport, ControlSnapshot } from '../src/control/index.ts'
import type {
  AgentDefinition,
  AliasDeclaration,
  AliasDefinition,
  AliasRegistryLayerSnapshot,
  ModelDeclaration,
  ModelDefinition,
} from '../src/contract/index.ts'

const PROJECT_PATH = '/work/.dsh/agents/registry.yaml'

function modelDefinition(
  modelName: string,
  provider: string,
  model: string,
  options: {
    readonly source?: ModelDefinition['source'] | undefined
    readonly available?: boolean | undefined
    readonly synthesized?: boolean | undefined
  } = {},
): ModelDefinition {
  const source = options.source ?? 'project-dsh'
  return {
    modelName,
    provider,
    model,
    available: options.available ?? true,
    source,
    ...(source === 'built-in' ? {} : { path: PROJECT_PATH }),
    ...(options.synthesized === true ? { synthesized: true } : {}),
  }
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
    ...(source === 'built-in' ? {} : { path: PROJECT_PATH }),
  }
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
  return {
    source,
    path: source === 'project-dsh' ? PROJECT_PATH : '/home/me/.dsh/agents/registry.yaml',
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

/** 一条池里有命中 / 未到达 / 停用 / 悬空四种 target 的别名。 */
function aliasSnapshot(): ControlSnapshot {
  return snapshotOf({
    layers: [
      layer('project-dsh', [
        rawModel('fast', 'acme', 'chat'),
        rawModel('slow', 'acme', 'slow'),
        rawModel('idle', 'acme', 'idle', false),
      ], [
        rawAlias('smart', ['fast', 'slow', 'idle', 'ghost']),
        rawAlias('twin', ['fast']),
        rawAlias('unused', ['slow']),
      ]),
    ],
    models: [
      modelDefinition('fast', 'acme', 'chat'),
      modelDefinition('slow', 'acme', 'slow'),
      modelDefinition('idle', 'acme', 'idle', { available: false }),
      modelDefinition('dsh-default', 'deepseek', 'chat', { source: 'built-in', synthesized: true }),
    ],
    aliases: [
      aliasDefinition('smart', ['fast', 'slow', 'idle', 'ghost']),
      aliasDefinition('twin', ['fast']),
      aliasDefinition('unused', ['slow']),
      aliasDefinition('default-alias', ['fast'], 'built-in'),
    ],
    agents: [agentDefinition('reviewer', ['smart']), agentDefinition('twin-user', ['twin'])],
  })
}

const REVIEWER_REPORT: AgentChainReport['report'] = {
  aliasChain: [{ orderIndex: 0, alias: 'smart', targets: ['fast', 'slow', 'idle', 'ghost'], modelName: 'fast' }],
  rawFallbackUsed: false,
  candidates: [
    { route: { provider: 'acme', model: 'chat' }, origin: 'alias', modelName: 'fast', orderIndex: 0, health: 'degraded' },
    { route: { provider: 'acme', model: 'slow' }, origin: 'alias', modelName: 'slow', orderIndex: 0, skipped: 'not-reached' },
    { route: { provider: 'acme', model: 'idle' }, origin: 'alias', modelName: 'idle', orderIndex: 0, skipped: 'unavailable', health: 'disabled' },
    { origin: 'alias', orderIndex: 0, skipped: 'unknown-model' },
  ],
  selectedBy: 'alias',
  effortSource: 'agent',
}

function readyChain(report: AliasChainReport = REVIEWER_REPORT, exhausted = false): AliasChainState {
  return { status: 'ready', alias: 'smart', agent: 'reviewer', report, exhausted }
}

function smartRow(snapshot: ControlSnapshot): AliasRow {
  const found = buildRegistryRows(snapshot, 'merged', 'alias').find((entry) => entry.name === 'smart')
  if (found === undefined || found.kind !== 'alias') throw new Error('fixture is missing alias smart')
  return found
}

function render(
  snapshot: ControlSnapshot,
  patch: Partial<ModelsPageState> = {},
  extra: {
    readonly chain?: AliasChainState | undefined
    readonly copied?: AliasCopyStatus | undefined
    readonly retry?: (() => void) | undefined
  } = {},
): string {
  return renderToStaticMarkup(h(ModelsPageView, {
    snapshot,
    state: { ...INITIAL_MODELS_PAGE_STATE, ...patch },
    onState: () => {},
    onSelect: () => {},
    chain: extra.chain,
    copied: extra.copied,
    onRetryChain: extra.retry,
  }))
}

function detailOf(html: string): string {
  const at = html.indexOf('class="model-detail"')
  return at < 0 ? '' : html.slice(at)
}

/** 详情里某条池 target 的 <li> 片段。 */
function poolRowOf(html: string, name: string): string {
  const at = html.indexOf('data-alias-pool="' + name + '"')
  if (at < 0) return ''
  const start = html.lastIndexOf('<li', at)
  const end = html.indexOf('</li>', at)
  return html.slice(start, end)
}

describe('解析链到池的投影', () => {
  const snapshot = aliasSnapshot()
  const row = smartRow(snapshot)
  const candidates = aliasCandidatesOf(REVIEWER_REPORT, 'smart')

  it('别名步骤与候选按 orderIndex 对齐，别的别名不混入', () => {
    expect(aliasStepOf(REVIEWER_REPORT, 'smart')?.orderIndex).toBe(0)
    expect(aliasCandidatesOf(REVIEWER_REPORT, 'smart')).toHaveLength(4)
    expect(aliasCandidatesOf(REVIEWER_REPORT, 'twin')).toEqual([])
    expect(candidateRouteLabel(candidates[3] as never)).toContain('目标模型条目缺失')
    expect(aliasWinnerCandidate(REVIEWER_REPORT, 'smart')?.modelName).toBe('fast')
  })

  it('池条目按路线对齐候选；悬空 target 不硬猜', () => {
    const entry = (name: string) => row.pool.find((item) => item.name === name)
    expect(candidateForPool(entry('fast') as never, candidates)?.health).toBe('degraded')
    expect(candidateForPool(entry('slow') as never, candidates)?.skipped).toBe('not-reached')
    expect(candidateForPool(entry('idle') as never, candidates)?.health).toBe('disabled')
    expect(candidateForPool(entry('ghost') as never, candidates)).toBeUndefined()
  })

  it('健康缺省读作未判定，不按 available 猜', () => {
    const entry = (name: string) => row.pool.find((item) => item.name === name)
    expect(poolHealthLabel(entry('fast') as never, candidates)).toBe('降级')
    expect(poolHealthLabel(entry('slow') as never, candidates)).toBe('未判定')
    expect(poolHealthLabel(entry('idle') as never, candidates)).toBe('已停用')
    expect(poolHealthLabel(entry('ghost') as never, candidates)).toBe('未判定')
  })

  it('池状态与健康分色：未到达灰，异常 warn/err', () => {
    expect(poolStateLabel('selected')).toBe('命中')
    expect(poolStateLabel('not-reached')).toBe('未到达')
    expect(poolStateLabel('unknown-model')).toBe('不存在')
    expect(poolStateLabel('disabled')).toBe('停用')
    expect(poolStateTagClass('selected')).toBe('tag-ok')
    expect(poolStateTagClass('not-reached')).toBe('tag-dim')
    expect(poolStateTagClass('unknown-model')).toBe('tag-err')
    expect(poolStateTagClass('disabled')).toBe('tag-warn')
    expect(healthTagClass(undefined)).toBe('tag-dim')
    expect(healthTagClass('active')).toBe('tag-ok')
    expect(healthTagClass('degraded')).toBe('tag-warn')
    expect(healthTagClass('disabled')).toBe('tag-err')
  })

  it('候选原因覆盖全部 skip 词，命中候选读作本次命中', () => {
    expect(chainSkipLabel('not-reached')).toBe('前序目标已命中，未到达')
    expect(chainSkipLabel('unknown-alias')).toBe('别名不存在')
    expect(chainSkipLabel('unknown-model')).toBe('目标模型条目不存在')
    expect(chainSkipLabel('unavailable')).toBe('available:false，解析时跳过')
    expect(chainSkipLabel('not-allowed')).toBe('不在允许的路线内')
    expect(chainSkipLabel('unsupported-effort')).toBe('不支持该 reasoning effort')
    expect(candidateSkipText(candidates[0] as never)).toBe('本次命中')
  })
})

describe('链结论', () => {
  it('命中时给出条目与路线；effort 来源有独立词', () => {
    expect(chainVerdictOf(REVIEWER_REPORT, 'smart', false)).toEqual({ text: '命中 fast · acme/chat', tone: 'ok' })
    expect(effortSourceLabel('chain')).toBe('目标条目')
    expect(effortSourceLabel('agent')).toBe('agent 默认')
    expect(effortSourceLabel('none')).toBe('未设置')
  })

  it('链耗尽、原始 model 回退与别名缺失各有结论', () => {
    const exhausted: AliasChainReport = {
      aliasChain: [{ orderIndex: 0, alias: 'smart', targets: ['ghost'] }],
      rawFallbackUsed: false,
      candidates: [{ origin: 'alias', orderIndex: 0, skipped: 'unknown-model' }],
      selectedBy: 'none',
      effortSource: 'none',
    }
    expect(chainVerdictOf(exhausted, 'smart', true)).toEqual({ text: '链耗尽：本别名的目标都没有命中', tone: 'err' })

    const raw: AliasChainReport = {
      aliasChain: [{ orderIndex: 0, alias: 'smart', targets: ['ghost'] }],
      rawFallbackUsed: true,
      candidates: [
        { origin: 'alias', orderIndex: 0, skipped: 'unknown-model' },
        { route: { provider: 'acme', model: 'raw' }, origin: 'raw' },
      ],
      selectedBy: 'raw',
      effortSource: 'chain',
    }
    expect(chainVerdictOf(raw, 'smart', false).tone).toBe('warn')
    expect(chainVerdictOf(raw, 'smart', false).text).toContain('原始 model 链')

    const missing: AliasChainReport = {
      aliasChain: [{ orderIndex: 0, alias: 'smart', targets: [], skipped: 'unknown-alias' }],
      rawFallbackUsed: false,
      candidates: [],
      selectedBy: 'none',
      effortSource: 'none',
    }
    expect(chainVerdictOf(missing, 'smart', false)).toEqual({ text: '别名不在 registry 快照里', tone: 'err' })
  })

  it('切换选中后到达的旧报告按未读取处理', () => {
    expect(chainForAlias(readyChain(), 'smart').status).toBe('ready')
    expect(chainForAlias(readyChain(), 'twin')).toEqual({ status: 'idle' })
  })
})

describe('重映射影响预览', () => {
  const snapshot = aliasSnapshot()
  const row = smartRow(snapshot)

  it('可选目标只取合并快照里 available 的条目，当前目标排第一', () => {
    const options = remapOptionsOf(snapshot, row)
    expect(options[0]?.name).toBe('fast')
    expect(options[0]?.current).toBe(true)
    expect(options.map((option) => option.name)).toContain('slow')
    expect(options.map((option) => option.name)).not.toContain('idle')
  })

  it('预览目标命中时用它，否则回落到当前目标', () => {
    const options = remapOptionsOf(snapshot, row)
    expect(activeRemapOption(options, 'slow')?.name).toBe('slow')
    expect(activeRemapOption(options, 'gone')?.name).toBe('fast')
    expect(activeRemapOption(options, null)?.current).toBe(true)
  })

  it('受影响集合走 remapImpact，不重跑链解析', () => {
    const preview = remapPreviewOf(snapshot, row, 'slow')
    expect(preview?.target.route).toBe('acme/slow')
    expect(preview?.current).toBe(false)
    expect(preview?.affected).toEqual(['reviewer'])
    expect(remapPreviewOf(snapshot, row, 'idle')).toBeUndefined()
  })
})

describe('别名详情静态输出', () => {
  const snapshot = aliasSnapshot()
  const selected: ModelsPageState['selected'] = { kind: 'alias', name: 'smart' }

  it('池按声明顺序列出；未读取链、使用者、fan-in、影响预览与跳转入口都在', () => {
    const detail = detailOf(render(snapshot, { selected }))
    expect(detail).toContain('目标池')
    expect(detail).toContain('解析链未读取')
    expect(detail.indexOf('data-alias-pool="fast"')).toBeGreaterThan(-1)
    expect(detail.indexOf('data-alias-pool="fast"')).toBeLessThan(detail.indexOf('data-alias-pool="slow"'))
    expect(detail.indexOf('data-alias-pool="slow"')).toBeLessThan(detail.indexOf('data-alias-pool="idle"'))
    expect(detail.indexOf('data-alias-pool="idle"')).toBeLessThan(detail.indexOf('data-alias-pool="ghost"'))
    expect(detail).toContain('使用者（Agent ×1）')
    expect(detail).toContain('在智能体列表定位 reviewer')
    expect(detail).toContain('同线路别名（fan-in）')
    expect(detail).toContain('在模型关联页定位别名 twin')
    expect(detail).not.toContain('default-alias')
    expect(detail).toContain('重映射影响预览')
    expect(detail).toContain('只读现有快照')
    expect(detail).toContain('复制名称')
    expect(detail).toContain('在模型关联页定位模型条目 fast')
    expect(detail).toContain('data-jump="agent"')
    expect(detail).toContain('data-jump="alias"')
    expect(detail).toContain('data-jump="model"')
  })

  it('链就绪后渲染候选诊断，未到达灰、降级 warn、停用 err 可区分', () => {
    const detail = detailOf(render(snapshot, { selected, remapTarget: 'slow' }, { chain: readyChain() }))
    expect(detail).toContain('解析链诊断（agent reviewer）')
    expect(detail).toContain('命中 fast · acme/chat')
    expect(detail).toContain('前序目标已命中，未到达')
    expect(detail).toContain('available:false，解析时跳过')
    expect(detail).toContain('目标模型条目不存在')
    expect(detail).toContain('候选 4 个')
    expect(detail).toContain('agent 默认')
    expect(detail).toContain('只读现有快照')

    const fast = poolRowOf(detail, 'fast')
    expect(fast).toContain('降级')
    expect(fast).toContain('tag-warn')
    const slow = poolRowOf(detail, 'slow')
    expect(slow).toContain('未判定')
    expect(slow).toContain('tag-dim')
    const idle = poolRowOf(detail, 'idle')
    expect(idle).toContain('已停用')
    expect(idle).toContain('tag-err')
    expect(poolRowOf(detail, 'ghost')).toContain('未判定')

    expect(detail).toContain('新目标 slow')
    expect(detail).toContain('acme/slow')
    expect(detail).toContain('受影响（Agent ×1）')
  })

  it('加载 / 失败态有可见文案与重试入口', () => {
    const loading = detailOf(render(snapshot, { selected }, { chain: { status: 'loading', alias: 'smart', agent: 'reviewer' } }))
    expect(loading).toContain('正在读取 reviewer 的解析链…')

    const failed = detailOf(render(snapshot, { selected }, {
      chain: { status: 'error', alias: 'smart', agent: 'reviewer', message: 'boom' },
      retry: () => {},
    }))
    expect(failed).toContain('解析链读取失败：boom')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('重试')
  })

  it('没有使用方时说明无链可读', () => {
    const detail = detailOf(render(snapshot, { selected: { kind: 'alias', name: 'unused' } }))
    expect(detail).toContain('没有 agent 的 modelOrder 使用这个别名。')
    expect(detail).not.toContain('解析链未读取')
  })

  it('复制反馈与模型条目详情保持独立', () => {
    const copied = detailOf(render(snapshot, { selected }, { copied: 'copied' }))
    expect(copied).toContain('已复制')
    const modelDetail = detailOf(render(snapshot, { kind: 'model', selected: { kind: 'model', name: 'fast' } }))
    expect(modelDetail).toContain('路线')
    expect(modelDetail).not.toContain('目标池')
    expect(modelDetail).not.toContain('解析链诊断')
  })
})
