/**
 * 别名详情正文（票 64）：池、解析链诊断、使用者 / fan-in 与重映射影响预览。
 *
 * 视图只渲染宿主已解析的快照与按需读面返回的报告（AliasChainState）；链
 * 诊断不在这里重跑引擎。类名与左侧列表同口径，样式仍由主 bundle 注入。
 */
import { createElement as h, Fragment } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PanelFocus, RegistryDestination } from '../src/dsh/client/chunk-contracts.ts'
import type { ControlSnapshot } from '../src/control/index.ts'
import type { AliasRow, RegistrySpace } from './registry-model.ts'
import { healthLabel, registryLayerLabel } from './registry-model.ts'
import {
  activeRemapOption,
  aliasCandidatesOf,
  candidateRouteLabel,
  candidateSkipText,
  chainForAlias,
  chainVerdictOf,
  effortSourceLabel,
  healthTagClass,
  poolHealthOf,
  poolStateLabel,
  poolStateTagClass,
  remapOptionsOf,
  remapPreviewOf,
} from './alias-detail.ts'

import type { AliasChainCandidate, AliasChainState } from './alias-detail.ts'

export interface AliasDetailProps {
  readonly snapshot: ControlSnapshot
  readonly row: AliasRow
  readonly space: RegistrySpace
  readonly chain: AliasChainState
  readonly remapTarget: string | null
  readonly onRetryChain?: (() => void) | undefined
  readonly onRemapTarget?: ((name: string) => void) | undefined
  readonly onRequestFocus?: ((focus: PanelFocus, destination?: RegistryDestination) => void) | undefined
}

/** 详情的事实行；模型条目详情也复用这一个（票 66 再扩字段）。 */
export interface FactProps {
  readonly label: string
  readonly children?: ReactNode
}

export function Fact(props: FactProps): ReactNode {
  return h(
    'div',
    { className: 'model-fact' },
    h('dt', null, props.label),
    h('dd', null, props.children),
  )
}

/** 别名详情的全部正文；调用方只负责标题栏（身份 / 复制 / 关闭）。 */
export function AliasDetailBody(props: AliasDetailProps): ReactNode {
  const row = props.row
  const chain = chainForAlias(props.chain, row.name)
  const candidates = chain.status === 'ready' ? aliasCandidatesOf(chain.report, row.name) : []
  return h(
    'div',
    { className: 'alias-detail' },
    h(
      'dl',
      { className: 'model-facts' },
      h(Fact, { label: '空间' }, spaceLabelOf(props.space) + ' · ' + registryLayerLabel(row.source)),
      h(Fact, { label: '文件' }, h('code', null, row.path ?? '（内置，无文件）')),
      h(Fact, { label: '目标' }, h(AliasTargetFact, { row, onRequestFocus: props.onRequestFocus })),
      h(Fact, { label: '层关系' }, row.layer.label === '' ? '无同名冲突' : row.layer.label),
    ),
    h(AliasPoolSection, { row, candidates }),
    h(ChainSection, { row, chain, candidates, onRetryChain: props.onRetryChain }),
    h(UsersSection, { row, onRequestFocus: props.onRequestFocus }),
    h(FanInSection, { row, onRequestFocus: props.onRequestFocus }),
    h(RemapSection, {
      snapshot: props.snapshot,
      row,
      remapTarget: props.remapTarget,
      onRequestFocus: props.onRequestFocus,
      onRemapTarget: props.onRemapTarget,
    }),
  )
}

function spaceLabelOf(space: RegistrySpace): string {
  if (space === 'project') return '工作区'
  if (space === 'user') return '用户'
  return '合并'
}

interface AliasTargetFactProps {
  readonly row: AliasRow
  readonly onRequestFocus: AliasDetailProps['onRequestFocus']
}

function AliasTargetFact(props: AliasTargetFactProps): ReactNode {
  const target = props.row.selectedTarget
  if (target === undefined) return h('span', { className: 'dim' }, '（没有可用目标）')
  return h(
    Fragment,
    null,
    h('code', null, target.name),
    h('span', { className: 'dim' }, ' · ' + (target.route ?? '（路线未知）')),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm alias-jump',
        'data-jump': 'model',
        'aria-label': '在模型关联页定位模型条目 ' + target.name,
        onClick: () => props.onRequestFocus?.({ kind: 'model', name: target.name }, 'models'),
      },
      '打开模型详情',
    ),
  )
}

interface AliasPoolSectionProps {
  readonly row: AliasRow
  readonly candidates: readonly AliasChainCandidate[]
}

function AliasPoolSection(props: AliasPoolSectionProps): ReactNode {
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '目标池 · 顺序即优先级（' + props.row.targets.length + ' 项）'),
    h(
      'ol',
      { className: 'alias-pool' },
      props.row.pool.map((entry) => {
        const health = poolHealthOf(entry, props.candidates)
        return h(
          'li',
          {
            key: String(entry.index) + entry.name,
            className: 'alias-pool-row',
            'data-alias-pool': entry.name,
          },
          h('span', { className: 'alias-pool-index', 'aria-hidden': true }, String(entry.index + 1)),
          h('code', { className: 'alias-pool-name' }, entry.name),
          h('span', { className: 'tag ' + poolStateTagClass(entry.state) }, poolStateLabel(entry.state)),
          h(
            'span',
            { className: 'tag ' + healthTagClass(health), title: 'health 来自解析报告；缺省未判定' },
            healthLabel(health),
          ),
          h('span', { className: 'alias-pool-reason' }, entry.reason),
          entry.route === undefined ? null : h('code', { className: 'alias-pool-route' }, entry.route),
        )
      }),
    ),
  )
}

interface ChainSectionProps {
  readonly row: AliasRow
  readonly chain: AliasChainState
  readonly candidates: readonly AliasChainCandidate[]
  readonly onRetryChain: AliasDetailProps['onRetryChain']
}

function ChainSection(props: ChainSectionProps): ReactNode {
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '解析链诊断'),
    chainBody(props),
  )
}

function chainBody(props: ChainSectionProps): ReactNode {
  const chain = props.chain
  if (props.row.users.length === 0) {
    return h('p', { className: 'dim alias-chain-note' }, '没有 agent 的 modelOrder 使用这个别名。')
  }
  if (chain.status === 'idle') {
    return h('p', { className: 'dim alias-chain-note' }, '解析链未读取（按需读面 /agent-atelier/chain）。')
  }
  if (chain.status === 'loading') {
    return h('p', { className: 'alias-chain-status', role: 'status' }, '正在读取 ' + chain.agent + ' 的解析链…')
  }
  if (chain.status === 'error') {
    return h(
      'div',
      { className: 'alias-chain-error', role: 'alert' },
      h('p', null, '解析链读取失败：' + chain.message),
      props.onRetryChain === undefined
        ? null
        : h('button', { type: 'button', className: 'btn btn-sm', onClick: props.onRetryChain }, '重试'),
    )
  }
  const verdict = chainVerdictOf(chain.report, props.row.name, chain.exhausted)
  return h(
    'details',
    { className: 'alias-chain-diag' },
    h('summary', null, '解析链诊断（agent ' + chain.agent + '）'),
    h(
      'div',
      { className: 'alias-chain-body' },
      h('div', { className: 'alias-chain-verdict' }, h('span', { className: 'tag tag-' + verdict.tone }, verdict.text)),
      chain.exhausted
        ? h('p', { className: 'alias-chain-warn', role: 'alert' }, '链耗尽：会话启动会按硬错误处理。')
        : null,
      h(
        'p',
        { className: 'dim alias-chain-note' },
        '候选 ' + props.candidates.length + ' 个 · reasoning effort 来源：' +
          effortSourceLabel(chain.report.effortSource) + ' · 只读现有快照',
      ),
      props.candidates.length === 0
        ? h('p', { className: 'dim' }, '这个别名在这条链里没有候选。')
        : h(
            'ol',
            { className: 'alias-chain-candidates' },
            props.candidates.map((candidate, index) => h(AliasCandidateRow, { key: index, candidate })),
          ),
      h('p', { className: 'dim alias-chain-note' }, '来自 /agent-atelier/chain 的解析报告；页面不重跑引擎。'),
    ),
  )
}

interface AliasCandidateRowProps {
  readonly candidate: AliasChainCandidate
}

function AliasCandidateRow(props: AliasCandidateRowProps): ReactNode {
  const candidate = props.candidate
  return h(
    'li',
    { className: 'alias-chain-candidate' },
    h('code', null, candidateRouteLabel(candidate)),
    h('span', { className: 'tag ' + healthTagClass(candidate.health) }, healthLabel(candidate.health)),
    h('span', { className: 'alias-chain-skip' }, candidateSkipText(candidate)),
    candidate.modelName === undefined
      ? null
      : h('span', { className: 'dim' }, '条目 ' + candidate.modelName),
  )
}

interface JumpSectionProps {
  readonly row: AliasRow
  readonly onRequestFocus: AliasDetailProps['onRequestFocus']
}

function UsersSection(props: JumpSectionProps): ReactNode {
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '使用者（Agent ×' + props.row.users.length + '）'),
    props.row.users.length === 0
      ? h('p', { className: 'dim' }, '没有 agent 的 modelOrder 使用这个别名。')
      : h(
          'div',
          { className: 'alias-chips' },
          props.row.users.map((name) => h(
            'button',
            {
              key: name,
              type: 'button',
              className: 'btn btn-sm alias-chip',
              'data-jump': 'agent',
              'aria-label': '在智能体列表定位 ' + name,
              onClick: () => props.onRequestFocus?.({ kind: 'agent', name }),
            },
            name,
          )),
        ),
  )
}

function FanInSection(props: JumpSectionProps): ReactNode {
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '同线路别名（fan-in）'),
    props.row.fanIn.length === 0
      ? h('p', { className: 'dim' }, '没有其它别名指向同一线路。')
      : h(
          'div',
          { className: 'alias-chips' },
          props.row.fanIn.map((alias) => h(
            'button',
            {
              key: alias.alias,
              type: 'button',
              className: 'btn btn-sm alias-chip',
              'data-jump': 'alias',
              'aria-label': '在模型关联页定位别名 ' + alias.alias,
              onClick: () => props.onRequestFocus?.({ kind: 'alias', name: alias.alias }, 'models'),
            },
            alias.alias,
          )),
        ),
  )
}

interface RemapSectionProps {
  readonly snapshot: ControlSnapshot
  readonly row: AliasRow
  readonly remapTarget: string | null
  readonly onRequestFocus: AliasDetailProps['onRequestFocus']
  readonly onRemapTarget: AliasDetailProps['onRemapTarget']
}

function RemapSection(props: RemapSectionProps): ReactNode {
  const options = remapOptionsOf(props.snapshot, props.row)
  const active = activeRemapOption(options, props.remapTarget)
  const preview = active === undefined
    ? undefined
    : remapPreviewOf(props.snapshot, props.row, active.name)
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '重映射影响预览'),
    options.length === 0
      ? h('p', { className: 'dim' }, '没有可用的模型条目可供预览。')
      : h(
          'select',
          {
            className: 'select',
            value: active?.name ?? '',
            'aria-label': '重映射目标',
            onChange: (event: ChangeEvent<HTMLSelectElement>) => props.onRemapTarget?.(event.target.value),
          },
          options.map((option) => h(
            'option',
            { key: option.name, value: option.name },
            option.current ? option.name + '（当前）' : option.name,
          )),
        ),
    preview === undefined
      ? null
      : h(
          'div',
          { className: 'alias-impact' },
          h('div', null, '新目标 ' + preview.target.name + ' · ' + preview.target.route),
          h(
            'div',
            { className: 'dim' },
            preview.current
              ? '目标未改变（仍是当前目标）。'
              : '当前目标 ' + (props.row.selectedTarget?.name ?? '（无）') + ' → ' + preview.target.name,
          ),
          h('div', null, '受影响（Agent ×' + preview.affected.length + '）'),
          preview.affected.length === 0
            ? h('p', { className: 'dim' }, '没有 agent 使用该别名；改动不影响会话。')
            : h(
                'div',
                { className: 'alias-chips' },
                preview.affected.map((name) => h(
                  'button',
                  {
                    key: name,
                    type: 'button',
                    className: 'btn btn-sm alias-chip',
                    'data-jump': 'agent',
                    'aria-label': '在智能体列表定位 ' + name,
                    onClick: () => props.onRequestFocus?.({ kind: 'agent', name }),
                  },
                  name,
                )),
              ),
          h('p', { className: 'alias-impact-note' }, '只读现有快照：预览不改写、不重跑引擎；别名注入名不变，受影响集合由 agent 的 modelOrder 决定，换 target 不改名单。写入归票 65。'),
        ),
  )
}
