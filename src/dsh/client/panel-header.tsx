/**
 * 插件面板头部（票 05；票 37 接入工作空间选择器）。
 *
 * 两行：
 *   题头行 = 标题「智能体工坊」+ 右侧工作空间选择器；
 *   页签行 = 主要页签（智能体 / 操作历史 / 配置）靠左，状态区（工作空间提示 /
 *   刷新中的忙碌态 / 失败信息）与刷新目录靠右。
 *
 * 选择器与状态提示都由页面算好（纯 props）：头部不读服务、不推导范围，
 * 静态渲染测试因此能覆盖三态（就绪 / 已回退 / 列表不可用）。
 */
import { createElement as h } from 'react'

import { nsClass } from './class-names.ts'
import { panelViewId } from './panel-types.ts'
import { WorkspaceSelect } from './workspace-select.tsx'

import type { PanelTab, ReloadState } from './panel-types.ts'
import type { ScopeListStatus, ScopeNotice, WorkspaceChoice } from './workspace-scope.ts'
import type { ReactNode } from 'react'

const TABS: readonly { readonly id: PanelTab; readonly label: string }[] = [
  { id: 'agents', label: '智能体' },
  { id: 'history', label: '操作历史' },
  { id: 'config', label: '配置' },
]

/** 头部要呈现的范围面（页面算好，头部只画）。 */
export interface PanelHeaderScope {
  readonly choice: WorkspaceChoice
  readonly choices: readonly WorkspaceChoice[]
  readonly status: ScopeListStatus
  /** 已回退 / 列表不可用 / 项目根提示；`undefined` 表示无需提示。 */
  readonly notice?: ScopeNotice | undefined
}

export interface PanelHeaderProps {
  readonly tab: PanelTab
  onTab(tab: PanelTab): void
  readonly reload: ReloadState
  onRefresh(): void
  readonly scope: PanelHeaderScope
  onSelectWorkspace(choice: WorkspaceChoice): void
}

export function PanelHeader(props: PanelHeaderProps): ReactNode {
  const reloading = props.reload.status === 'reloading'
  const notice = props.scope.notice

  return h('header', { className: nsClass('panel-header') },
    h('div', { className: 'panel-header-top' },
      h('div', { className: 'panel-header-title' }, '智能体工坊'),
      h(WorkspaceSelect, {
        choice: props.scope.choice,
        choices: props.scope.choices,
        status: props.scope.status,
        warn: notice?.severity === 'warn',
        onSelect: props.onSelectWorkspace,
      })),

    h('div', { className: 'panel-header-tabs-row' },
      h('div', { className: 'panel-tabs', role: 'tablist', 'aria-label': '智能体工坊视图' },
        TABS.map((tab) => h('button',
          {
            key: tab.id,
            type: 'button',
            role: 'tab',
            id: `panel-tab-${tab.id}`,
            className: `panel-tab${props.tab === tab.id ? ' active' : ''}`,
            'aria-selected': props.tab === tab.id,
            'aria-controls': panelViewId(tab.id),
            onClick: () => props.onTab(tab.id),
          },
          tab.label))),

      h('div', { className: 'panel-header-tools' },
        notice !== undefined && h('span', {
          className: `panel-header-status${notice.severity === 'warn' ? ' panel-header-error' : ' dim'}`,
          role: 'status',
          title: notice.text,
        }, notice.text),
        props.reload.status === 'reloading' && h('span', { className: 'panel-header-status dim', role: 'status' }, '刷新中…'),
        props.reload.status === 'failed' && h('span', {
          className: 'panel-header-status panel-header-error',
          role: 'alert',
          title: props.reload.message,
        }, `刷新失败：${props.reload.message}`),
        h('button',
          {
            type: 'button',
            className: 'btn btn-sm btn-icon panel-refresh',
            'aria-label': '刷新目录',
            title: '刷新目录（invalidate）',
            disabled: reloading,
            onClick: props.onRefresh,
          },
          '↻'))),
  )
}
