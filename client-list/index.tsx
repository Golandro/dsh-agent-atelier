/**
 * List chunk entry (ticket 05) — `lib/client.list.js`.
 *
 * 原型 Agent 列表的移植：TanStack Table v9（函数式 feature API）＋ 冻结的
 * 单点列表求值器 `evaluateAgentQuery`。UI 状态（搜索词 / 层筛选 / 排序 /
 * 视图模式）组装成 11 冻结词表的 `AgentListQuery` 交给求值器，表实例只做
 * 状态容器（manualSorting / manualFiltering，行模型管线直通），不做第二次
 * 过滤排序——同一份查询口径只有一个解释者。chunk 自包含，唯一外部依赖是
 * 平台注入的 `react`；样式由主 bundle 注入，这里只挂 CSS 类名。
 */
import { createElement as h, Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { evaluateAgentQuery } from '../src/control/index.ts'
import type { AgentListQuery, AgentRow } from '../src/control/index.ts'
import type { AgentListViewProps } from '../src/dsh/client/chunk-contracts.ts'
import { ListPane } from './list-pane.tsx'
import { deriveRows, displayName, layerRank, modelCount } from './rows.ts'
import { AgentCard, AgentDetail } from './row-view.tsx'

/** 层筛选的 UI 取值：'all' 是「全部层级」哨兵，组装冻结查询时换回 undefined。 */
type LayerFilter = 'all' | NonNullable<AgentListQuery['layer']>

/** 排序键 = 11 冻结词表（name / layer / issues / models）。 */
type SortKey = NonNullable<AgentListQuery['sort']>

/** 列表的 UI 状态（视图模式单独放，它不是查询的一部分）。 */
interface ListUiState {
  readonly text: string
  readonly layer: LayerFilter
  readonly onlyIssues: boolean
  readonly sort: SortKey
  readonly direction: 'asc' | 'desc'
}

const INITIAL_UI: ListUiState = { text: '', layer: 'all', onlyIssues: false, sort: 'name', direction: 'asc' }

/** 排序键的展示词：issues 用「诊断」（冻结词 issues 指诊断计数）。 */
const SORT_LABEL: Readonly<Record<SortKey, string>> = { name: '名称', layer: '层级', issues: '诊断', models: '模型数' }

type ViewMode = 'content' | 'compact'

/**
 * v9 函数式 feature API 在模块作用域固定，避免每次渲染重建。
 * 只装三个「状态切片」feature：过滤与排序已由冻结求值器完成，不注册
 * filteredRowModel / sortedRowModel 行模型工厂（管线直通），也不再注册
 * 原型的 sortFns / filterFns 注册表——表引擎的过滤排序函数不会被调用。
 */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
})

/**
 * 逻辑列：只承载四个冻结排序轴的取值，渲染由行组件负责（内容行不是
 * 二维表格）。id 与冻结 AgentListQuery 的 sort 值一一对应，排序状态
 * （SortingState）的 id 因此可以直接落进查询。
 */
const columns: ColumnDef<typeof features, AgentRow>[] = [
  { id: 'name', accessorFn: (row) => displayName(row.agent) },
  { id: 'layer', accessorFn: (row) => layerRank(row.agent.source) },
  { id: 'issues', accessorFn: (row) => row.errors * 10 + row.hints },
  { id: 'models', accessorFn: (row) => modelCount(row.agent) },
]

export function AgentListView(props: AgentListViewProps): unknown {
  const { snapshot, selected, onSelect } = props
  const [mode, setMode] = useState<ViewMode>('content')
  const [ui, setUi] = useState<ListUiState>(INITIAL_UI)
  const listRef = useRef<HTMLElement>(null)

  const allRows = useMemo(() => deriveRows(snapshot), [snapshot])
  /** UI 状态 → 冻结 AgentListQuery → 唯一求值器（filter 先行、排序稳定）。 */
  const query = useMemo<AgentListQuery>(
    () => ({
      text: ui.text,
      layer: ui.layer === 'all' ? undefined : ui.layer,
      onlyIssues: ui.onlyIssues,
      sort: ui.sort,
      direction: ui.direction,
    }),
    [ui],
  )
  const rows = useMemo<readonly AgentRow[]>(() => evaluateAgentQuery(allRows, query), [allRows, query])

  /** 表状态是 UI 状态的受控投影：由 ui 派生，on*Change 再写回 ui。 */
  const sorting = useMemo<SortingState>(() => [{ id: ui.sort, desc: ui.direction === 'desc' }], [ui.sort, ui.direction])
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = []
    if (ui.layer !== 'all') filters.push({ id: 'layer', value: ui.layer })
    if (ui.onlyIssues) filters.push({ id: 'issues', value: 0 })
    return filters
  }, [ui.layer, ui.onlyIssues])

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { sorting, globalFilter: ui.text, columnFilters },
    // 求值走冻结 evaluateAgentQuery，表引擎不做二次过滤/排序（行模型管线直通）。
    manualSorting: true,
    manualFiltering: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    // 稳定 row id：过滤/排序变化时 DOM 复用不丢（React key 用它）。
    getRowId: (row) => row.agent.agentName,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const head = next[0]
      if (!head) return
      setUi((q) => ({ ...q, sort: head.id as SortKey, direction: head.desc ? 'desc' : 'asc' }))
    },
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === 'function' ? updater(ui.text) : updater
      setUi((q) => ({ ...q, text: String(next ?? '') }))
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater
      const layer = next.find((filter) => filter.id === 'layer')?.value
      setUi((q) => ({
        ...q,
        layer: (layer as LayerFilter | undefined) ?? 'all',
        onlyIssues: next.some((filter) => filter.id === 'issues'),
      }))
    },
  })

  const tableRows = table.getRowModel().rows

  // 视图/查询变化会让行高和顺序变化；在布局提交后立刻把选中项拉回可视区。
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-agent]')
    const el = nodes ? Array.from(nodes).find((node) => node.dataset.agent === selected) : undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [mode, selected, ui, rows.length])

  /** 「筛选无命中」空态的清空按钮：只清筛选，保留排序方向。 */
  const clearFilters = () => setUi((q) => ({ ...q, text: '', layer: 'all', onlyIssues: false }))

  return h(
    ListPane,
    {
      listRef,
      className: mode === 'content' ? 'agent-list content-mode' : 'agent-list compact-mode',
      title: '智能体',
      count: `${tableRows.length}/${snapshot.agents.length}`,
      headAction: h(
        'div',
        { className: 'agent-view-toggle', role: 'group', 'aria-label': 'Agent 列表视图' },
        h(
          'button',
          {
            type: 'button',
            className: mode === 'content' ? 'active' : '',
            'aria-pressed': mode === 'content',
            onClick: () => setMode('content'),
          },
          '内容',
        ),
        h(
          'button',
          {
            type: 'button',
            className: mode === 'compact' ? 'active' : '',
            'aria-pressed': mode === 'compact',
            onClick: () => setMode('compact'),
          },
          '紧凑',
        ),
      ),
      tools: h(
        Fragment,
        null,
        h('input', {
          className: 'input list-search',
          type: 'search',
          value: ui.text,
          // 冻结求值器的 haystack 只覆盖 agentName / 显示名 / 描述，占位文案据此收敛。
          placeholder: '搜索名称 / 描述',
          'aria-label': '搜索 agent',
          onChange: (event: ChangeEvent<HTMLInputElement>) => table.setGlobalFilter(event.target.value),
        }),
        h(
          'div',
          { className: 'list-filter-row' },
          h(
            'select',
            {
              className: 'select list-filter',
              value: ui.layer,
              'aria-label': '按层级筛选',
              onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                const layer = event.target.value as LayerFilter
                // 展示词 workspace 对应冻结查询里的 project 层。
                table.getColumn('layer')?.setFilterValue(layer === 'all' ? undefined : layer)
              },
            },
            h('option', { value: 'all' }, '全部层级'),
            h('option', { value: 'project' }, 'workspace'),
            h('option', { value: 'user' }, 'user'),
            h('option', { value: 'bundled' }, 'bundled'),
          ),
          h(
            'select',
            {
              className: 'select list-filter',
              value: ui.sort,
              'aria-label': '排序字段',
              onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                const sort = event.target.value as SortKey
                // 诊断轴默认降序（问题多的排前面），其余默认升序。
                table.setSorting([{ id: sort, desc: sort === 'issues' }])
              },
            },
            (Object.keys(SORT_LABEL) as SortKey[]).map((key) =>
              h('option', { key, value: key }, `按${SORT_LABEL[key]}`),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'btn-icon list-sort-dir',
              title: ui.direction === 'asc' ? '升序（点击切降序）' : '降序（点击切升序）',
              'aria-label': ui.direction === 'asc' ? '升序' : '降序',
              onClick: () => table.setSorting([{ id: ui.sort, desc: ui.direction === 'asc' }]),
            },
            ui.direction === 'asc' ? '↑' : '↓',
          ),
          h(
            'button',
            {
              type: 'button',
              className: ui.onlyIssues ? 'btn btn-sm btn-primary' : 'btn btn-sm',
              'aria-pressed': ui.onlyIssues,
              onClick: () => table.getColumn('issues')?.setFilterValue(ui.onlyIssues ? undefined : 0),
            },
            '仅问题',
          ),
        ),
      ),
      children: h(
        Fragment,
        null,
        // 空态两档：库里没有 agent（重试走页面壳的 Reload），或有库但筛选无命中。
        snapshot.agents.length === 0
          ? h('div', { className: 'list-empty dim' }, '没有发现任何 agent')
          : tableRows.length === 0
            ? h(
                'div',
                { className: 'list-empty dim' },
                '没有匹配的 agent',
                h('button', { type: 'button', className: 'btn btn-sm', onClick: clearFilters }, '清空筛选'),
              )
            : null,
        h(
          'div',
          { className: 'agent-rows', role: 'listbox', 'aria-label': 'Agent 列表' },
          tableRows.map((row) => {
            const { agent, errors, hints } = row.original
            const common = {
              agent,
              selected: selected === agent.agentName,
              errors,
              hints,
              onSelect: () => onSelect(agent.agentName),
            }
            return mode === 'content' ? h(AgentDetail, { key: row.id, ...common }) : h(AgentCard, { key: row.id, ...common })
          }),
        ),
      ),
    },
  )
}
