/**
 * 模型关联列表的一行（票 63）：两行结构，全部字段来自 registry-model 的行。
 *
 * 第一行：名称 / 目标（模型条目行是 provider-model）/ provider-model / 引用计数；
 * 第二行：层标签 / 状态与遮蔽标注 / path。行本身是 listbox 的 option；选中态
 * 只由父级传入，箭头键与 Enter 的语义在页面层。
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import { registryLayerLabel } from './registry-model.ts'
import type { RegistryRow } from './registry-model.ts'
import {
  aliasTargetLabel,
  relationTagClass,
  rowAriaLabel,
  rowIssueTags,
  rowPathLabel,
  rowRefCount,
  rowRefLabel,
  rowRoute,
  sourceTagClass,
} from './model-links.ts'

export interface ModelRowViewProps {
  readonly row: RegistryRow
  readonly selected: boolean
  /** 列表的 roving tab stop：选中行不可见时落在可见首行，保证 Tab 仍能进入列表。 */
  readonly tabStop: boolean
  readonly onSelect: () => void
}

export function ModelRowView(props: ModelRowViewProps): ReactNode {
  const row = props.row
  const route = rowRoute(row)
  const target = row.kind === 'alias' ? aliasTargetLabel(row) : route ?? '未声明路线'
  const relationClass = relationTagClass(row.layer.kind)
  const tags = rowIssueTags(row)

  return h(
    'button',
    {
      type: 'button',
      role: 'option',
      'aria-selected': props.selected,
      'aria-label': rowAriaLabel(row),
      'data-model-row': row.key,
      tabIndex: props.tabStop ? 0 : -1,
      className: `model-row${props.selected ? ' selected' : ''}`,
      onClick: props.onSelect,
    },
    h(
      'span',
      { className: 'model-row-main' },
      h('span', { className: 'model-row-name', title: row.name }, row.name),
      h('span', { className: 'model-row-target', title: target }, target),
      row.kind === 'alias' && route !== undefined
        ? h('span', { className: 'model-row-route', title: route }, route)
        : null,
      h('span', { className: 'model-row-flex' }),
      h(
        'span',
        { className: `model-ref-count${rowRefCount(row) === 0 ? ' none' : ''}` },
        rowRefLabel(row),
      ),
    ),
    h(
      'span',
      { className: 'model-row-sub' },
      h('span', { className: `tag ${sourceTagClass(row.source)}` }, registryLayerLabel(row.source)),
      ...tags.map((tag) => h('span', { key: tag.text, className: `tag ${tag.className}` }, tag.text)),
      relationClass === null
        ? null
        : h('span', { className: `tag ${relationClass}` }, row.layer.label),
      h(
        'span',
        { className: 'model-row-path', title: rowPathLabel(row) },
        h('code', { className: 'model-row-path-text' }, rowPathLabel(row)),
      ),
    ),
  )
}
