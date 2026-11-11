/**
 * 模型关联页（票 63）：主从双栏的列表与空间/类别切换。
 *
 * 页面分两层：
 * - ModelsPageView 是受控视图（快照 + 页面状态 + 两个回调），静态可测；
 * - ModelRegistryView 是 chunk 入口，持有状态、消费跨页聚焦目标，并把选中
 *   交给列表。详情内容归票 64/66，本票的右侧只落「身份与层事实」的详情壳，
 *   解析链、影响预览与写动作由后续票替换。
 *
 * 数据纪律：行只来自 registry-model 的 buildRegistryRows（宿主已解析快照，
 * 不重跑层合并）；搜索/排序只走 evaluateRegistryQuery。切空间时若同名条目
 * 在目标空间仍存在就保留选中，否则跟到第一条，空间为空才清空——规则写在
 * model-links.ts 并由测试固定。
 */
import { createElement as h, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type { RegistryViewProps } from '../src/dsh/client/chunk-contracts.ts'
import type { ControlSnapshot } from '../src/control/index.ts'
import { ListPane } from './list-pane.tsx'
import { ModelRowView } from './model-rows.tsx'
import { PaneSplitter, usePaneLayout } from './pane.tsx'
import { registryLayerLabel } from './registry-model.ts'
import {
  aliasTargetLabel,
  effectiveSelection,
  emptyReasonOf,
  kindNoun,
  layerCountsOf,
  registryListOf,
  registryQueryOf,
  relationTagClass,
  resolveFocusTarget,
  rowPathLabel,
  rowRoute,
  selectionKey,
  selectionOfRow,
  sourceTagClass,
  spaceLabel,
  stepSelection,
} from './model-links.ts'

import type {
  LayerCounts,
  RegistrySelection,
} from './model-links.ts'
import type {
  RegistryKind,
  RegistryListQuery,
  RegistryRow,
  RegistrySpace,
} from './registry-model.ts'

/** 列表排序轴：与 RegistryListQuery 的 sort 词表一一对应。 */
export type RegistrySortKey = NonNullable<RegistryListQuery['sort']>

const SORT_LABEL: Readonly<Record<RegistrySortKey, string>> = { name: '名称', refs: '引用数', layer: '层级' }
const SORT_KEYS: readonly RegistrySortKey[] = ['name', 'refs', 'layer']

const SPACES: readonly { readonly id: RegistrySpace; readonly label: string; readonly title: string }[] = [
  { id: 'merged', label: '合并', title: '合并视图：按层解析后的生效条目' },
  { id: 'project', label: '工作区', title: '工作区层 · .dsh/agents/registry.yaml（同名条目压过用户层）' },
  { id: 'user', label: '用户', title: '用户层 · ~/.dsh/agents/registry.yaml（低优先级）' },
]

/** 页面状态；selected 由 onSelect 单独写，其余字段走 onState 补丁。 */
export interface ModelsPageState {
  readonly space: RegistrySpace
  readonly kind: RegistryKind
  readonly text: string
  readonly sort: RegistrySortKey
  readonly direction: 'asc' | 'desc'
  readonly onlyIssues: boolean
  readonly selected: RegistrySelection | null
  readonly detailOpen: boolean
}

export const INITIAL_MODELS_PAGE_STATE: ModelsPageState = {
  space: 'merged',
  kind: 'alias',
  text: '',
  sort: 'name',
  direction: 'asc',
  onlyIssues: false,
  selected: null,
  detailOpen: true,
}

export type ModelsPagePatch = Partial<Pick<ModelsPageState, 'space' | 'kind' | 'text' | 'sort' | 'direction' | 'onlyIssues' | 'detailOpen'>>

export interface ModelsPageViewProps {
  readonly snapshot: ControlSnapshot
  readonly state: ModelsPageState
  onState(patch: ModelsPagePatch): void
  onSelect(selection: RegistrySelection): void
}

/** 受控视图：所有状态由外部传入，SSR / 组件测试直接按状态渲染。 */
export function ModelsPageView(props: ModelsPageViewProps): ReactNode {
  const { snapshot, state } = props
  const projectAvailable = snapshot.scope.projectRoot !== null
  // 用户全局没有项目根：工作区按钮禁用，当前若仍停在 project 就显示合并（不改写状态，
  // 下一份快照带回项目根时自动恢复用户原来的选择）。
  const space: RegistrySpace = state.space === 'project' && !projectAvailable ? 'merged' : state.space
  const query = useMemo(
    () => registryQueryOf({ text: state.text, sort: state.sort, direction: state.direction, onlyIssues: state.onlyIssues }),
    [state.text, state.sort, state.direction, state.onlyIssues],
  )
  const list = useMemo(
    () => registryListOf(snapshot, space, state.kind, query),
    [snapshot, space, state.kind, query],
  )
  const allRows = list.allRows
  const rows = list.rows
  const selection = effectiveSelection(state.selected, allRows, rows, state.kind)
  const selectedKey = selection === null ? null : selectionKey(selection, space)
  const selectedRow = selectedKey === null
    ? null
    : allRows.find((row) => row.key === selectedKey) ?? null
  // 选中行被筛选掉时，roving tab stop 落在可见首行；否则列表没有可 Tab 进入的行。
  const tabStopKey = selectedKey !== null && rows.some((row) => row.key === selectedKey)
    ? selectedKey
    : (rows[0]?.key ?? null)
  const emptyReason = emptyReasonOf(snapshot, space, state.kind, allRows, rows)
  const counts = layerCountsOf(snapshot)

  const pageRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const pane = usePaneLayout(pageRef, { measureKey: `${space}:${state.kind}` })
  /** 键盘步进后要把 DOM 焦点放到新行；鼠标点击已经自带焦点。 */
  const keyboardFocusRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    findRowElement(listRef.current, selectedKey)?.scrollIntoView({ block: 'nearest' })
  }, [selectedKey, space, state.kind])

  useLayoutEffect(() => {
    const key = keyboardFocusRef.current
    if (key === null) return
    keyboardFocusRef.current = null
    findRowElement(listRef.current, key)?.focus()
  }, [selectedKey])

  const moveSelection = (delta: 1 | -1): void => {
    const next = stepSelection(rows, selectedKey, delta)
    if (next === null) return
    const nextKey = selectionKey(next, space)
    if (nextKey !== selectedKey) keyboardFocusRef.current = nextKey
    props.onSelect(next)
  }

  const handleBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      // Enter 打开焦点所在行；行内按钮的默认激活被 preventDefault 收走，这里只发
      // 一次选中 + 打开，避免「焦点在 A、打开 B」或双重 onSelect。
      const key = focusedRowKey(event.target) ?? selectedKey
      if (key === null) return
      event.preventDefault()
      if (key !== selectedKey) {
        const row = rows.find((entry) => entry.key === key)
        if (row !== undefined) props.onSelect(selectionOfRow(row))
      }
      props.onState({ detailOpen: true })
    }
  }

  const closeDetail = (): void => props.onState({ detailOpen: false })

  return h(
    'section',
    {
      ref: pageRef,
      className: `models-page${state.detailOpen ? '' : ' detail-closed'}`,
      'data-registry-view': 'models',
      'aria-label': '模型关联',
    },
    h(
      'div',
      {
        className: 'models-body',
        style: { '--models-list-w': `${Math.round(pane.listWidth)}px` } as CSSProperties,
      },
      h(ListPane, {
        listRef,
        className: 'models-list',
        title: '模型关联',
        count: `${rows.length}/${allRows.length}`,
        headAction: h(
          'div',
          { className: 'seg-switch', role: 'group', 'aria-label': 'registry 空间' },
          SPACES.map((option) => {
            const disabled = option.id === 'project' && !projectAvailable
            return h(
              'button',
              {
                key: option.id,
                type: 'button',
                className: space === option.id ? 'active' : '',
                'aria-pressed': space === option.id,
                disabled,
                title: option.title,
                ...(disabled ? { 'aria-describedby': 'models-space-note' } : {}),
                onClick: () => props.onState({ space: option.id }),
              },
              option.label,
            )
          }),
        ),
        tools: h(
          Fragment,
          null,
          h('input', {
            className: 'input list-search',
            type: 'search',
            value: state.text,
            placeholder: state.kind === 'alias' ? '搜索别名 / 目标 / 使用方' : '搜索模型 / provider / 别名 / agent',
            'aria-label': state.kind === 'alias' ? '搜索别名' : '搜索模型条目',
            onChange: (event: ChangeEvent<HTMLInputElement>) => props.onState({ text: event.target.value }),
          }),
          h(
            'div',
            { className: 'list-filter-row' },
            h(
              'div',
              { className: 'seg-switch', role: 'group', 'aria-label': '条目类别' },
              h(
                'button',
                {
                  type: 'button',
                  className: state.kind === 'alias' ? 'active' : '',
                  'aria-pressed': state.kind === 'alias',
                  onClick: () => props.onState({ kind: 'alias' }),
                },
                '别名',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: state.kind === 'model' ? 'active' : '',
                  'aria-pressed': state.kind === 'model',
                  onClick: () => props.onState({ kind: 'model' }),
                },
                '模型条目',
              ),
            ),
            h(
              'select',
              {
                className: 'select list-filter',
                value: state.sort,
                'aria-label': '排序字段',
                onChange: (event: ChangeEvent<HTMLSelectElement>) => props.onState({ sort: event.target.value as RegistrySortKey }),
              },
              SORT_KEYS.map((key) => h('option', { key, value: key }, `按${SORT_LABEL[key]}`)),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'btn-icon list-sort-dir',
                title: state.direction === 'asc' ? '升序（点击切降序）' : '降序（点击切升序）',
                'aria-label': state.direction === 'asc' ? '升序' : '降序',
                onClick: () => props.onState({ direction: state.direction === 'asc' ? 'desc' : 'asc' }),
              },
              state.direction === 'asc' ? '↑' : '↓',
            ),
            h(
              'button',
              {
                type: 'button',
                className: state.onlyIssues ? 'btn btn-sm btn-primary' : 'btn btn-sm',
                'aria-pressed': state.onlyIssues,
                onClick: () => props.onState({ onlyIssues: !state.onlyIssues }),
              },
              '仅异常',
            ),
          ),
          !projectAvailable
            ? h(
                'div',
                { className: 'registry-space-note', id: 'models-space-note' },
                '当前为用户全局（无项目根）：工作区层不可用。',
                space === 'merged' && state.space === 'project' ? '已显示合并视图。' : null,
              )
            : null,
        ),
        onBodyKeyDown: handleBodyKeyDown,
        children: h(
          Fragment,
          null,
          emptyReason === null
            ? null
            : h(EmptyState, {
                reason: emptyReason,
                kind: state.kind,
                onClear: () => props.onState({ text: '', onlyIssues: false }),
              }),
          rows.length === 0
            ? null
            : h(
                'div',
                { className: 'model-rows', role: 'listbox', 'aria-label': `${kindNoun(state.kind)}列表` },
                rows.map((row) => h(ModelRowView, {
                  key: row.key,
                  row,
                  selected: row.key === selectedKey,
                  tabStop: row.key === tabStopKey,
                  onSelect: () => props.onSelect(selectionOfRow(row)),
                })),
              ),
        ),
      }),
      state.detailOpen
        ? h(PaneSplitter, {
            label: '调整列表宽度（列表最小 20rem，详情最小 40rem）',
            value: pane.listWidth,
            min: pane.minList,
            max: pane.maxListWidth,
            onResize: pane.setListWidth,
            onReset: pane.resetListWidth,
          })
        : null,
      state.detailOpen
        ? h(ModelDetailPane, {
            space,
            selectedRow,
            counts,
            onClose: closeDetail,
          })
        : null,
    ),
  )
}

interface EmptyStateProps {
  readonly reason: NonNullable<ReturnType<typeof emptyReasonOf>>
  readonly kind: RegistryKind
  readonly onClear: () => void
}

/** 列表空态：筛选无命中 / 工作区不可用 / 层缺失 / 该层为空 / 全局没有条目。 */
function EmptyState(props: EmptyStateProps): ReactNode {
  const noun = kindNoun(props.kind)
  const copy = emptyCopy(props.reason, noun)
  return h(
    'div',
    { className: 'list-empty' },
    h('div', { className: 'model-empty-title' }, copy.title),
    h('div', { className: 'dim' }, copy.body),
    props.reason === 'filtered'
      ? h('button', { type: 'button', className: 'btn btn-sm', onClick: props.onClear }, '清除筛选')
      : null,
  )
}

function emptyCopy(reason: EmptyStateProps['reason'], noun: string): { readonly title: string; readonly body: string } {
  switch (reason) {
    case 'filtered':
      return { title: `没有匹配的${noun}`, body: '换关键词，或清除当前筛选。' }
    case 'space-unavailable':
      return { title: '工作区层不可用', body: '当前范围为用户全局（没有项目根）；在面板顶部选择工作空间后可用。' }
    case 'layer-missing':
      return { title: '当前空间没有 registry 层', body: '工作区层是 .dsh/agents/registry.yaml；用户层是 ~/.dsh/agents/registry.yaml。' }
    case 'layer-empty':
      return { title: `该层还没有声明${noun}`, body: '在当前层新增条目后，这里会显示。' }
    case 'registry-empty':
      return { title: `还没有任何${noun}`, body: '条目来自 registry.yaml 的 models: 与 aliases: 段。' }
  }
}

interface ModelDetailPaneProps {
  readonly space: RegistrySpace
  readonly selectedRow: RegistryRow | null
  readonly counts: LayerCounts
  readonly onClose: () => void
}

/** 详情壳（票 63）：只显示行上已有的身份与层事实；详情内容归票 64/66。 */
function ModelDetailPane(props: ModelDetailPaneProps): ReactNode {
  const row = props.selectedRow
  const relationClass = row === null ? null : relationTagClass(row.layer.kind)
  return h(
    'section',
    { className: 'model-detail', 'aria-label': '条目详情' },
    h(
      'div',
      { className: 'model-detail-head' },
      row === null
        ? h('span', { className: 'model-detail-name dim' }, '未选择条目')
        : h(
            Fragment,
            null,
            h('span', { className: 'tag tag-scope' }, kindNoun(row.kind)),
            h('span', { className: 'model-detail-name', title: row.name }, row.name),
            h('span', { className: `tag ${sourceTagClass(row.source)}` }, registryLayerLabel(row.source)),
            relationClass === null ? null : h('span', { className: `tag ${relationClass}` }, row.layer.label),
          ),
      h('span', { className: 'model-detail-fill' }),
      h(
        'button',
        {
          type: 'button',
          className: 'btn-icon model-detail-close',
          title: '关闭详情',
          'aria-label': '关闭详情',
          onClick: props.onClose,
        },
        '×',
      ),
    ),
    h(
      'div',
      { className: 'model-detail-body' },
      row === null
        ? h(
            'div',
            { className: 'model-detail-empty' },
            h('div', { className: 'model-empty-title' }, '未选择条目'),
            h('p', { className: 'dim' }, '在左侧选择别名或模型条目，查看层与关联摘要。'),
          )
        : h(
            Fragment,
            null,
            h(
              'dl',
              { className: 'model-facts' },
              h(Fact, { label: '空间' }, `${spaceLabel(props.space)} · ${registryLayerLabel(row.source)}`),
              h(Fact, { label: '文件' }, h('code', null, rowPathLabel(row))),
              row.kind === 'alias'
                ? h(Fact, { label: '目标' }, aliasTargetLabel(row), rowRoute(row) === undefined ? null : h('span', { className: 'dim' }, ` · ${rowRoute(row)}`))
                : h(Fact, { label: '路线' }, h('code', null, rowRoute(row) ?? '未声明')),
              h(Fact, { label: '层关系' }, row.layer.label === '' ? '无同名冲突' : row.layer.label),
            ),
          ),
      row === null
        ? h(
            'div',
            { className: 'model-empty-summary' },
            `合并后 ${props.counts.mergedModels} 个模型 / ${props.counts.mergedAliases} 个别名 · `,
            `工作区 ${props.counts.projectAvailable ? `${props.counts.projectModels} / ${props.counts.projectAliases}` : '不可用'} · `,
            `用户 ${props.counts.userModels} / ${props.counts.userAliases}`,
          )
        : null,
    ),
  )
}

interface FactProps {
  readonly label: string
  readonly children?: ReactNode
}

function Fact(props: FactProps): ReactNode {
  return h(
    'div',
    { className: 'model-fact' },
    h('dt', null, props.label),
    h('dd', null, props.children),
  )
}

/** 键盘步进后找行：不用 CSS.escape，属性值只含 kind/space/name，直接按 dataset 比对。 */
function findRowElement(root: HTMLElement | null, key: string | null): HTMLElement | undefined {
  if (root === null || key === null) return undefined
  return Array.from(root.querySelectorAll<HTMLElement>('[data-model-row]'))
    .find((element) => element.dataset.modelRow === key)
}

/** 事件源所在的行 key（Enter 打开焦点行）。 */
function focusedRowKey(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null
  return target.closest<HTMLElement>('[data-model-row]')?.dataset.modelRow ?? null
}

/** chunk 入口：状态在这里，视图在 ModelsPageView。 */
export function ModelRegistryView(props: RegistryViewProps): ReactNode {
  const [state, setState] = useState<ModelsPageState>(INITIAL_MODELS_PAGE_STATE)
  const applyState = (patch: ModelsPagePatch): void => setState((previous) => ({ ...previous, ...patch }))
  const select = (selection: RegistrySelection): void => setState((previous) => ({
    ...previous,
    selected: selection,
    detailOpen: true,
  }))

  // 跨页聚焦：目标在当前空间找不到时切合并空间（票 60 的裁决），找到才消费；
  // 目标还没进快照就不消费，等下一份快照再试。
  useEffect(() => {
    const focus = props.focus
    if (focus === null || focus === undefined) return
    const target = resolveFocusTarget(focus, props.snapshot, state.space)
    if (target === null) return
    setState((previous) => ({
      ...previous,
      space: target.space,
      kind: target.kind,
      text: '',
      onlyIssues: false,
      selected: { kind: target.kind, name: target.name },
      detailOpen: true,
    }))
    props.onFocusConsumed?.()
  }, [props.focus, props.snapshot, state.space, props.onFocusConsumed])

  return h(ModelsPageView, {
    snapshot: props.snapshot,
    state,
    onState: applyState,
    onSelect: select,
  })
}
