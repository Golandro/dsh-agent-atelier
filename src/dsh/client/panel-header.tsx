/**
 * 插件面板头部（票 05）。
 *
 * 两行：
 *   题头行 = 标题「智能体工坊」+ 右侧工作空间选择器占位（尚未实现）；
 *   页签行 = 主要页签（智能体 / 操作历史 / 配置）靠左，刷新目录靠右。
 * 刷新中的忙碌态与失败信息也收在页签行，避免再占一条状态栏。
 */
import { createElement as h } from 'react'
import { nsClass } from './class-names.ts'
import { panelViewId } from './panel-types.ts'

import type { PanelTab, ReloadState } from './panel-types.ts'
import type { ReactNode } from 'react'

const TABS: readonly { readonly id: PanelTab; readonly label: string }[] = [
  { id: 'agents', label: '智能体' },
  { id: 'history', label: '操作历史' },
  { id: 'config', label: '配置' },
]

export interface PanelHeaderProps {
  readonly tab: PanelTab
  onTab(tab: PanelTab): void
  readonly reload: ReloadState
  onRefresh(): void
}

export function PanelHeader(props: PanelHeaderProps): ReactNode {
  const reloading = props.reload.status === 'reloading'

  return h('header', { className: nsClass('panel-header') },
    h('div', { className: 'panel-header-top' },
      h('div', { className: 'panel-header-title' }, '智能体工坊'),
      h('button',
        {
          type: 'button',
          className: 'panel-workspace',
          disabled: true,
          title: '工作空间选择器（尚未实现）',
          'aria-label': '工作空间选择器（尚未实现）',
        },
        h('span', { className: 'panel-workspace-label' }, '工作空间'),
        h('span', { className: 'panel-workspace-caret', 'aria-hidden': true }, '▾'))),

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
