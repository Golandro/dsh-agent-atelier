/**
 * 列表面板外壳（原型 ListPane 1:1 移植）。
 *
 * Agent 列表与后续列表类页面共用同一套骨架：粘性头部（标题 + 计数 +
 * 头部动作）、工具区、行区域。外壳不感知业务，页面差异全部由插槽注入；
 * chunk 自包含，不引用主 bundle（样式由主 bundle 注入，这里只挂类名）。
 */
import { createElement as h } from 'react'
import type { KeyboardEventHandler, ReactNode, RefObject } from 'react'

export interface ListPaneProps {
  readonly title: string
  /** 标题右侧的计数（如 12/18）；不传则不渲染。 */
  readonly count?: ReactNode
  /** 标题行右端的插件位（视图切换、新建…）。 */
  readonly headAction?: ReactNode
  /** 工具区插件位（搜索、筛选、排序…）；不传则不渲染工具区。 */
  readonly tools?: ReactNode
  /** 行区域。 */
  readonly children: ReactNode
  readonly className?: string
  readonly listRef?: RefObject<HTMLElement | null>
  /** 行区域的语义角色（如 listbox）与无障碍名。 */
  readonly bodyRole?: string
  readonly bodyLabel?: string
  readonly onBodyKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

export function ListPane(props: ListPaneProps): ReactNode {
  return h(
    'aside',
    {
      ref: props.listRef,
      className: props.className === undefined ? 'list-pane' : `list-pane ${props.className}`,
    },
    h(
      'div',
      { className: 'list-pane-top' },
      h(
        'div',
        { className: 'list-pane-head' },
        h(
          'div',
          { className: 'list-pane-title' },
          props.title,
          props.count === undefined ? null : h('span', { className: 'list-pane-count' }, props.count),
        ),
        props.headAction === undefined ? null : props.headAction,
      ),
      props.tools === undefined ? null : h('div', { className: 'list-pane-tools' }, props.tools),
    ),
    h(
      'div',
      {
        className: 'list-pane-body',
        role: props.bodyRole,
        'aria-label': props.bodyLabel,
        onKeyDown: props.onBodyKeyDown,
      },
      props.children,
    ),
  )
}
