/**
 * PROTOTYPE — 列表面板外壳（共用父控件）。
 *
 * Agent 列表与 Section 列表共用同一套骨架：粘性头部（标题 + 计数 + 头部动作）、工具区、行区域。
 * 外壳不感知业务：页面差异全部由插槽注入——
 *   headAction  标题行右端（视图切换、新建…）
 *   tools       工具区（搜索、筛选、排序…）
 *   children    行区域
 * 行本身（AgentCard / AgentDetail / SectionRow）是各自的子控件插件，外壳只负责滚动与粘性头。
 */
import type { KeyboardEventHandler, ReactNode, RefObject } from 'react'

export interface ListPaneProps {
  title: string
  /** 标题右侧的计数（如 12/18）；不传则不渲染 */
  count?: ReactNode
  /** 标题行右端的插件位 */
  headAction?: ReactNode
  /** 工具区插件位；不传则不渲染工具区 */
  tools?: ReactNode
  /** 行区域 */
  children: ReactNode
  className?: string
  listRef?: RefObject<HTMLElement | null>
  /** 行区域的语义角色（如 listbox）与无障碍名 */
  bodyRole?: string
  bodyLabel?: string
  onBodyKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

export function ListPane(props: ListPaneProps) {
  return (
    <aside ref={props.listRef} className={`list-pane${props.className ? ` ${props.className}` : ''}`}>
      <div className="list-pane-top">
        <div className="list-pane-head">
          <div className="list-pane-title">
            {props.title}
            {props.count !== undefined && <span className="list-pane-count">{props.count}</span>}
          </div>
          {props.headAction}
        </div>
        {props.tools !== undefined && <div className="list-pane-tools">{props.tools}</div>}
      </div>
      <div
        className="list-pane-body"
        role={props.bodyRole}
        aria-label={props.bodyLabel}
        onKeyDown={props.onBodyKeyDown}
      >
        {props.children}
      </div>
    </aside>
  )
}
