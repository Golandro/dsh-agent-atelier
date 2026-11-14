/**
 * 行组件（原型 AgentRow / AgentDetail / AgentCard 移植）。
 *
 * 行是扁平的两行排布：第 1 行 来源标签 | 名称 | 弹性空白 | 路径 | 状态；
 * 第 2 行（展开态）摘要 | 属性链。内容视图 = 两行全显（AgentDetail），
 * 紧凑视图 = 只留第 1 行（AgentCard）；行内不提供折叠按钮，由列表头的
 * 视图切换统一控制。字段全部来自冻结 AgentDefinition——原型 AgentDoc 的
 * `disabled` 演示扩展没有 schema 对应字段（Q1 裁决：v1 不做启停），不移植。
 */
import { createElement as h } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { displayName, layerLabel, layerTag } from './rows.ts'
import type { AgentDefinition } from './rows.ts'

export interface AgentRowProps {
  readonly agent: AgentDefinition
  readonly selected: boolean
  readonly errors: number
  readonly hints: number
  readonly expanded: boolean
  readonly onSelect: () => void
}

export function AgentRow(props: AgentRowProps): ReactNode {
  const agent = props.agent
  const tag = layerTag(agent.source)
  const rawModel = (agent.model ?? []).map((target) => `${target.provider}/${target.model}`)
  const modelChain = agent.modelOrder?.length
    ? agent.modelOrder.join(' → ')
    : rawModel.length
      ? `raw ${rawModel.join(', ')}`
      : '无'
  const attrs = [
    `模型 ${modelChain}`,
    agent.requiredTools?.length ? `工具 ${agent.requiredTools.join(', ')}` : null,
    agent.skills?.length ? `技能 ${agent.skills.join(', ')}` : null,
    agent.spawn ? `spawn ${agent.spawn}` : null,
    agent.reasoningEffort ? `reasoning ${agent.reasoningEffort}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(' · ')
  const hasIssues = props.errors + props.hints > 0
  const desc = agent.description.trim() || '（无描述）'
  const statusTitle = `${props.errors} 个错误 · ${props.hints} 个提示`

  return h(
    'div',
    {
      className: `agent-row${props.selected ? ' selected' : ''}${props.expanded ? ' expanded' : ' collapsed'}`,
      'data-agent': agent.agentName,
      role: 'option',
      'aria-selected': props.selected,
      'aria-label': `${displayName(agent)}，${layerLabel(agent.source)}，${props.errors} 个错误 ${props.hints} 个提示`,
      tabIndex: 0,
      onClick: props.onSelect,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect()
        }
      },
    },
    h(
      'div',
      { className: 'agent-row-primary' },
      h('span', { className: `agent-source-tag ${tag}`, title: layerLabel(agent.source) }, tag),
      h('span', { className: 'agent-row-name', title: `${displayName(agent)} · ${agent.agentName}` }, displayName(agent)),
      h('span', { className: 'agent-row-flex' }),
      h('span', { className: 'agent-row-path', title: agent.path }, agent.path),
      h(
        'span',
        { className: 'agent-row-status', title: statusTitle },
        hasIssues
          ? h(
              'span',
              { className: `agent-badge ${props.errors > 0 ? 'err' : 'warn'}` },
              `${props.errors > 0 ? `${props.errors}E` : ''}${props.hints > 0 ? `${props.hints}H` : ''}`,
            )
          : h('span', { className: 'agent-status-dot ok', 'aria-label': '无诊断' }),
      ),
    ),
    props.expanded
      ? h(
          'div',
          { className: 'agent-row-secondary' },
          h(
            'span',
            {
              className: `agent-row-desc${agent.description.trim() ? '' : ' empty'}`,
              title: agent.description === '' ? undefined : agent.description,
            },
            desc,
          ),
          attrs === '' ? null : h('span', { className: 'agent-row-attrs', title: attrs }, attrs),
        )
      : null,
  )
}

export interface AgentDetailProps {
  readonly agent: AgentDefinition
  readonly selected: boolean
  readonly errors: number
  readonly hints: number
  readonly onSelect: () => void
}

/** 内容视图：两行全显态。展开/紧凑由列表头的视图切换决定，行内无切换按钮。 */
export function AgentDetail(props: AgentDetailProps): ReactNode {
  return h(AgentRow, { ...props, expanded: true })
}

/** 紧凑视图：内容行的折叠态（只保留第 1 行），不套卡片外壳。 */
export function AgentCard(props: AgentDetailProps): ReactNode {
  return h(AgentRow, { ...props, expanded: false })
}
