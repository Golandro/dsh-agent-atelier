/**
 * 「最近写入」面板（票 05，Inspector 收窄版）：
 * - 只呈现真实 commit 产生的 WriteReport（逐文件 ok / 失败 + code + message）；
 * - 顺带展示待写入 plan 的 entries 预览 chips（确认交互在编辑器 chrome 里）；
 * - 原型的虚拟 FS 与操作日志不移植（Q2 最小口径）。
 * 面板同时承载「刷新目录」（invalidate）入口与重载失败重试。
 */
import { createElement as h, useState } from 'react'
import type { WritePlan, WriteReport } from '../../control/index.ts'
import type { ReactNode } from 'react'

/** invalidate 流程的状态（页面持有，面板只呈现）。 */
export type ReloadState =
  | { readonly status: 'idle' }
  | { readonly status: 'reloading' }
  | { readonly status: 'failed'; readonly message: string }

export interface RecentWritesProps {
  /** 待写入预览（plan 成功后出现）；null 表示当前没有待确认的写入。 */
  readonly plan: WritePlan | null
  /** 历史 WriteReport，最新在前。 */
  readonly reports: readonly WriteReport[]
  readonly reload: ReloadState
  /** 刷新目录：client.invalidate() → 重新 snapshot + recompose（页面实现）。 */
  onInvalidate(): void
}

export function RecentWrites(props: RecentWritesProps): ReactNode {
  const [open, setOpen] = useState(true)
  const fileCount = props.reports.reduce((n, report) => n + report.results.length, 0)

  return h('footer', { className: 'inspector' },
    h('div', { className: 'inspector-bar' },
      h('button',
        {
          type: 'button',
          className: 'inspector-toggle',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        },
        h('span', { className: 'inspector-caret', 'aria-hidden': true }, open ? '▾' : '▸'),
        `最近写入（${props.reports.length} 笔 · ${fileCount} 文件）`),
      props.reload.status === 'reloading' && h('span', { className: 'dim' }, '目录刷新中…'),
      props.reload.status === 'failed' && h('span', { className: 'inspector-error', role: 'alert' },
        `刷新失败：${props.reload.message}`,
        h('button', { type: 'button', className: 'btn btn-sm', onClick: props.onInvalidate }, '重试')),
      h('span', { className: 'editor-spacer' }),
      h('button',
        { type: 'button', className: 'btn btn-sm', disabled: props.reload.status === 'reloading', onClick: props.onInvalidate },
        '刷新目录')),
    open && h('div', { className: 'inspector-body' },
      props.plan !== null && props.plan.entries.length > 0 && renderPendingPlan(props.plan),
      props.reports.length === 0 && props.plan === null
        ? h('div', { className: 'dim' }, '（尚无写入）')
        : props.reports.map((report, i) => renderReport(report, i))))
}

/** 待写入预览：逐 entry 一个 chip（文件 · 覆盖块），确认按钮在编辑器 chrome。 */
function renderPendingPlan(plan: WritePlan): ReactNode {
  return h('section', { className: 'inspector-sec' },
    h('h5', null, `待写入预览（${plan.entries.length} 文件）`),
    h('div', { className: 'plan-chips' },
      plan.entries.map((entry, i) => h('span', { key: i, className: 'plan-chip' },
        h('code', null, entry.file), ` · ${entry.blockIds.join(' / ')}`))))
}

/** 一次 commit 的 WriteReport：逐文件 ok / 失败（code + message）。 */
function renderReport(report: WriteReport, index: number): ReactNode {
  return h('section', { key: index, className: 'inspector-sec' },
    h('h5', null, `第 ${index + 1} 笔`),
    report.results.map((result, i) => {
      const file = result.ok ? result.file : (result.file ?? '（未知文件）')
      return h('div', { key: i, className: 'write-row' },
        h('span', { className: `tag ${result.ok ? 'tag-ok' : 'tag-err'}` }, result.ok ? '已写入' : '失败'),
        h('code', { className: 'fs-path' }, file),
        !result.ok && h('span', { className: 'dim' }, `${result.code} · ${result.message}`))
    }))
}
