/**
 * PROTOTYPE — Agent 列表（P1 A 区）：资源管理器「内容」排布 + TanStack Table。
 *
 * 行（AgentRow）：
 *   第 1 行  来源标签 | 名称 | 弹性空白 | 路径 | 状态
 *   第 2 行  摘要 | 模型链 / 工具 / 技能 / spawn / reasoning
 * 内容 = 两行全显；紧凑 = 只留第 1 行（视图级折叠），都不使用卡片外壳。
 * 行内不再提供展开/折叠按钮。
 *
 * 查询接口 AgentListQuery 仍是外部契约；过滤/排序由 TanStack Table v9 执行：
 * - globalFilter（搜索词干）→ includesString
 * - columnFilters（层级 / 仅问题）→ 自定义 layer 比较 / greaterThan
 * - sorting（名称 / 层级 / 诊断 / 模型数）
 * 列表头切换“内容 / 紧凑”。窄屏保持纵向列表（app.css 响应式）。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_greaterThan,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table'
import type { AgentDoc, AgentListQuery, AgentListSortKey, Finding } from '../types'
import { agentHaystack, displayName, layerRank, layerTag, modelCount, type AgentListRow } from '../model'
import { AgentCard } from './AgentCard'
import { AgentDetail } from './AgentDetail'

export interface AgentListProps {
  agents: AgentDoc[]
  findings: Finding[]
  selected: string
  onSelect: (agentName: string) => void
}

type ViewMode = 'content' | 'compact'

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

/** v9 features 在模块作用域固定，避免每次渲染重建行模型。 */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
  filterFns: {
    includesString: filterFn_includesString,
    greaterThan: filterFn_greaterThan,
  },
})

/**
 * 逻辑列：内容行不是二维表格，但过滤/排序需要可访问的值。
 * 只有 search 列参与全局搜索；path 等列仅用于渲染/后续扩展。
 */
const columns: ColumnDef<typeof features, AgentListRow>[] = [
  {
    id: 'name',
    accessorFn: (row) => displayName(row.agent),
    sortFn: 'text',
    enableGlobalFilter: false,
    enableColumnFilter: false,
  },
  {
    id: 'layer',
    accessorFn: (row) => layerRank(row.agent),
    sortFn: 'basic',
    // 值是排序用的 rank，过滤值来自 UI 的 layer tag。
    filterFn: (row, _columnId, filterValue) => layerTag(row.original.agent.source) === filterValue,
    enableGlobalFilter: false,
  },
  {
    id: 'diagnostics',
    accessorFn: (row) => row.errs * 10 + row.hints,
    sortFn: 'basic',
    enableGlobalFilter: false,
    enableColumnFilter: false,
  },
  {
    id: 'models',
    accessorFn: (row) => modelCount(row.agent),
    sortFn: 'basic',
    enableGlobalFilter: false,
    enableColumnFilter: false,
  },
  {
    id: 'issues',
    accessorFn: (row) => row.errs + row.hints,
    filterFn: 'greaterThan',
    enableGlobalFilter: false,
    enableSorting: false,
  },
  {
    id: 'search',
    accessorFn: (row) => agentHaystack(row.agent),
    enableSorting: false,
    enableColumnFilter: false,
  },
  {
    id: 'path',
    accessorFn: (row) => row.agent.path,
    enableSorting: false,
    enableGlobalFilter: false,
    enableColumnFilter: false,
  },
]

export function AgentList(props: AgentListProps) {
  const [mode, setMode] = useState<ViewMode>('content')
  const [query, setQuery] = useState<AgentListQuery>(INITIAL_QUERY)
  const listRef = useRef<HTMLElement>(null)

  const data = useMemo<AgentListRow[]>(
    () =>
      props.agents.map((agent) => {
        const own = props.findings.filter((f) => f.agentName === agent.agentName)
        return {
          agent,
          errs: own.filter((f) => f.severity === 'error').length,
          hints: own.filter((f) => f.severity === 'hint').length,
        }
      }),
    [props.agents, props.findings],
  )

  const sorting = useMemo<SortingState>(
    () => [{ id: query.sort, desc: query.direction === 'desc' }],
    [query.sort, query.direction],
  )
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = []
    if (query.layer !== 'all') filters.push({ id: 'layer', value: query.layer })
    if (query.onlyIssues) filters.push({ id: 'issues', value: 0 })
    return filters
  }, [query.layer, query.onlyIssues])

  const table = useTable({
    features,
    columns,
    data,
    state: { sorting, globalFilter: query.text, columnFilters },
    globalFilterFn: 'includesString',
    enableMultiSort: false,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const head = next[0]
      if (!head) return
      setQuery((q) => ({ ...q, sort: head.id as AgentListSortKey, direction: head.desc ? 'desc' : 'asc' }))
    },
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === 'function' ? updater(query.text) : updater
      setQuery((q) => ({ ...q, text: String(next ?? '') }))
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater
      const layer = next.find((f) => f.id === 'layer')?.value
      setQuery((q) => ({
        ...q,
        layer: (layer as AgentListQuery['layer']) ?? 'all',
        onlyIssues: next.some((f) => f.id === 'issues'),
      }))
    },
  })

  const rows = table.getRowModel().rows
  const switchMode = (next: ViewMode) => setMode(next)
  const setSort = (sort: AgentListSortKey) =>
    table.setSorting([{ id: sort, desc: sort === 'diagnostics' }])
  const setLayer = (layer: AgentListQuery['layer']) =>
    table.getColumn('layer')?.setFilterValue(layer === 'all' ? undefined : layer)

  // 视图/查询变化会让行高和顺序变化；在布局提交后立刻把选中项拉回可视区。
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-agent]')
    const el = nodes ? Array.from(nodes).find((n) => n.dataset.agent === props.selected) : undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [mode, props.selected, query, rows.length])

  return (
    <aside ref={listRef} className={`agent-list ${mode === 'content' ? 'content-mode' : 'compact-mode'}`}>
      <div className="agent-list-top">
        <div className="agent-list-head">
          <div className="agent-list-title">
            Agent List <span className="agent-list-count">{rows.length}/{props.agents.length}</span>
          </div>
          <div className="agent-view-toggle" role="group" aria-label="Agent 列表视图">
            <button
              type="button"
              className={mode === 'content' ? 'active' : ''}
              aria-pressed={mode === 'content'}
              onClick={() => switchMode('content')}
            >内容</button>
            <button
              type="button"
              className={mode === 'compact' ? 'active' : ''}
              aria-pressed={mode === 'compact'}
              onClick={() => switchMode('compact')}
            >紧凑</button>
          </div>
        </div>

        <div className="agent-list-tools">
          <input
            className="input agent-search"
            type="search"
            value={query.text}
            placeholder="搜索名称 / 描述 / 路径 / 模型"
            aria-label="搜索 agent"
            onChange={(e) => table.setGlobalFilter(e.target.value)}
          />
          <div className="agent-filter-row">
            <select
              className="select agent-filter"
              value={query.layer}
              aria-label="按层级筛选"
              onChange={(e) => setLayer(e.target.value as AgentListQuery['layer'])}
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
              onClick={() => table.setSorting([{ id: query.sort, desc: query.direction === 'asc' }])}
            >{query.direction === 'asc' ? '↑' : '↓'}</button>
            <button
              type="button"
              className={`btn btn-sm${query.onlyIssues ? ' btn-primary' : ''}`}
              aria-pressed={query.onlyIssues}
              onClick={() => table.getColumn('issues')?.setFilterValue(query.onlyIssues ? undefined : 0)}
            >仅问题</button>
          </div>
        </div>
      </div>

      {rows.length === 0 && <div className="agent-list-empty dim">没有匹配的 agent</div>}

      <div className="agent-rows" role="listbox" aria-label="Agent 列表">
        {rows.map((row) => {
          const { agent: a, errs, hints } = row.original
          const common = {
            agent: a,
            selected: props.selected === a.agentName,
            errs,
            hints,
            onSelect: () => props.onSelect(a.agentName),
          }
          return mode === 'content' ? (
            <AgentDetail key={row.id} {...common} />
          ) : (
            <AgentCard key={row.id} {...common} />
          )
        })}
      </div>
    </aside>
  )
}
