/**
 * PROTOTYPE — Agent 列表（P1 A 区）：专业列表视图 + 详情/半卡片。
 * - 查询接口 AgentListQuery：文本 / 层 / 仅问题 + 名称/层级/诊断/模型数排序。
 * - 详情 = AgentDetail：双行（身份行 + 字段网格），扁平列表，不是卡片外壳。
 * - 半卡片 = AgentCard：详情折叠后的形态，保留自己的边框约束内容。
 * 头部切换视图；单项也可用 ▸/▾ 独立展开/折叠（半卡片 = 详情的折叠态）。
 * 窄屏时变为横向滑动条（app.css 响应式）。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { AgentDoc, AgentListQuery, AgentListSortKey, Finding } from '../types'
import { queryAgents } from '../model'
import { AgentCard } from './AgentCard'
import { AgentDetail } from './AgentDetail'

export interface AgentListProps {
  agents: AgentDoc[]
  findings: Finding[]
  selected: string
  onSelect: (agentName: string) => void
}

type ViewMode = 'detail' | 'compact'

const INITIAL_QUERY: AgentListQuery = {
  text: '',
  layer: 'all',
  onlyIssues: false,
  sort: 'name',
  direction: 'asc',
}

const SORT_LABEL: Record<AgentListSortKey, string> = {
  name: '名称',
  layer: '层级',
  diagnostics: '诊断',
  models: '模型数',
}

export function AgentList(props: AgentListProps) {
  const [mode, setMode] = useState<ViewMode>('detail')
  /** 单项覆盖：true = 展开为详情，false = 折叠为半卡片；缺省跟随 mode */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState<AgentListQuery>(INITIAL_QUERY)
  const listRef = useRef<HTMLElement>(null)
  const rows = queryAgents(props.agents, props.findings, query)
  const isOpen = (name: string) => overrides[name] ?? mode === 'detail'
  const switchMode = (next: ViewMode) => {
    setMode(next)
    setOverrides({})
  }
  const patchQuery = (patch: Partial<AgentListQuery>) => setQuery((q) => ({ ...q, ...patch }))
  const setSort = (sort: AgentListSortKey) =>
    patchQuery({ sort, direction: sort === 'diagnostics' ? 'desc' : 'asc' })

  // 视图/查询变化会让行高和顺序变化；在布局提交后立刻把选中项拉回可视区。
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-agent]')
    const el = nodes ? Array.from(nodes).find((n) => n.dataset.agent === props.selected) : undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [mode, props.selected, query])

  return (
    <aside ref={listRef} className={`agent-list ${mode === 'detail' ? 'detail-mode' : 'cards-mode'}`}>
      <div className="agent-list-top">
        <div className="agent-list-head">
          <div className="agent-list-title">
            Agent List <span className="agent-list-count">{rows.length}/{props.agents.length}</span>
          </div>
          <div className="agent-view-toggle" role="group" aria-label="Agent 列表视图">
            <button
              type="button"
              className={mode === 'detail' ? 'active' : ''}
              aria-pressed={mode === 'detail'}
              onClick={() => switchMode('detail')}
            >详情</button>
            <button
              type="button"
              className={mode === 'compact' ? 'active' : ''}
              aria-pressed={mode === 'compact'}
              onClick={() => switchMode('compact')}
            >半卡片</button>
          </div>
        </div>

        <div className="agent-list-tools">
          <input
            className="input agent-search"
            type="search"
            value={query.text}
            placeholder="搜索名称 / 描述 / 模型"
            aria-label="搜索 agent"
            onChange={(e) => patchQuery({ text: e.target.value })}
          />
          <div className="agent-filter-row">
            <select
              className="select agent-filter"
              value={query.layer}
              aria-label="按层级筛选"
              onChange={(e) => patchQuery({ layer: e.target.value as AgentListQuery['layer'] })}
            >
              <option value="all">全部层级</option>
              <option value="workspace">workspace</option>
              <option value="user">user</option>
              <option value="bundled">bundled</option>
            </select>
            <select
              className="select agent-filter"
              value={query.sort}
              aria-label="排序字段"
              onChange={(e) => setSort(e.target.value as AgentListSortKey)}
            >
              {(Object.keys(SORT_LABEL) as AgentListSortKey[]).map((key) => (
                <option key={key} value={key}>按{SORT_LABEL[key]}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn-icon agent-sort-dir"
              title={query.direction === 'asc' ? '升序（点击切降序）' : '降序（点击切升序）'}
              aria-label={query.direction === 'asc' ? '升序' : '降序'}
              onClick={() => patchQuery({ direction: query.direction === 'asc' ? 'desc' : 'asc' })}
            >{query.direction === 'asc' ? '↑' : '↓'}</button>
            <button
              type="button"
              className={`btn btn-sm${query.onlyIssues ? ' btn-primary' : ''}`}
              aria-pressed={query.onlyIssues}
              onClick={() => patchQuery({ onlyIssues: !query.onlyIssues })}
            >仅问题</button>
          </div>
        </div>
      </div>

      {rows.length === 0 && <div className="agent-list-empty dim">没有匹配的 agent</div>}

      {rows.map(({ agent: a, errs, hints }) => {
        const common = {
          agent: a,
          selected: props.selected === a.agentName,
          errs,
          hints,
          onSelect: () => props.onSelect(a.agentName),
        }
        return isOpen(a.agentName) ? (
          <AgentDetail
            key={a.agentName}
            {...common}
            onCollapse={() => setOverrides((o) => ({ ...o, [a.agentName]: false }))}
          />
        ) : (
          <AgentCard
            key={a.agentName}
            {...common}
            onExpand={() => setOverrides((o) => ({ ...o, [a.agentName]: true }))}
          />
        )
      })}
    </aside>
  )
}
