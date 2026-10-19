/**
 * 「操作历史」视图（票 05；由原「最近写入」状态栏升格为页签）。
 *
 * - 只呈现真实 commit 产生的 WriteReport（逐文件 ok / 失败 + code + message）；
 * - 顺带展示待写入 plan 的 entries 预览 chips（确认交互在编辑器 chrome 里）；
 * - 原型的虚拟 FS 与操作日志不移植（Q2 最小口径）。
 *
 * 刷新目录入口已移到面板头部；本视图只呈现数据，不再自带工具栏/折叠态。
 */
import { createElement as h } from 'react'
import { nsClass } from './class-names.ts'
import type { WritePlan, WriteReport } from '../../control/index.ts'
import type { ReactNode } from 'react'

export interface OperationHistoryProps {
  /** 待写入预览（plan 成功后出现）；null 表示当前没有待确认的写入。 */
  readonly plan: WritePlan | null
  /** 历史 WriteReport，最新在前。 */
  readonly reports: readonly WriteReport[]
  /** 页签未选中时保持挂载（不丢滚动位置），由 hidden 属性隐藏。 */
  readonly hidden?: boolean
}

export function OperationHistory(props: OperationHistoryProps): ReactNode {
  const fileCount = props.reports.reduce((n, report) => n + report.results.length, 0)
  const empty = props.reports.length === 0 && props.plan === null

  return h('section',
    {
      className: nsClass('history-view'),
      id: 'panel-view-history',
      role: 'tabpanel',
      'aria-labelledby': 'panel-tab-history',
      hidden: props.hidden === true,
    },
    h('div', { className: 'history-head' },
      h('h2', { className: 'history-title' }, '操作历史'),
      h('span', { className: 'dim' }, `${props.reports.length} 笔 · ${fileCount} 文件`)),
    h('div', { className: 'history-body' },
      props.plan !== null && props.plan.entries.length > 0 && renderPendingPlan(props.plan),
      empty
        ? h('div', { className: 'dim history-empty' }, '（尚无操作）')
        : props.reports.map(renderReport)))
}

/** 待写入预览：逐 entry 一个 chip（文件 · 覆盖块），确认按钮在编辑器 chrome。 */
function renderPendingPlan(plan: WritePlan): ReactNode {
  return h('section', { className: 'history-sec' },
    h('h5', null, `待写入预览（${plan.entries.length} 文件）`),
    h('div', { className: 'plan-chips' },
      plan.entries.map((entry, i) => h('span', { key: i, className: 'plan-chip' },
        h('code', null, entry.file), ` · ${entry.blockIds.join(' / ')}`))))
}

/** 一次 commit 的 WriteReport：逐文件 ok / 失败（code + message）。 */
function renderReport(report: WriteReport, index: number): ReactNode {
  return h('section', { key: index, className: 'history-sec' },
    h('h5', null, `第 ${index + 1} 笔`),
    report.results.map((result, i) => {
      const file = result.ok ? result.file : (result.file ?? '（未知文件）')
      return h('div', { key: i, className: 'write-row' },
        h('span', { className: `tag ${result.ok ? 'tag-ok' : 'tag-err'}` }, result.ok ? '已写入' : '失败'),
        h('code', { className: 'fs-path' }, file),
        !result.ok && h('span', { className: 'dim' }, `${result.code} · ${result.message}`))
    }))
}
