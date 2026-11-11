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
import type { PanelFocus, RegistryDestination, RegistryViewProps } from '../src/dsh/client/chunk-contracts.ts'
import type { ControlSnapshot, RegistryEdit } from '../src/control/index.ts'
import { AliasDetailBody } from './alias-detail.tsx'
import { ListPane } from './list-pane.tsx'
import { AddModelForm, ModelDetailBody } from './model-detail.tsx'
import {
  EMPTY_ADD_MODEL_DRAFT,
  addModelCheckOf,
  buildAddModelEdit,
  deleteModelEditOf,
  setAvailableEditOf,
} from './model-detail.ts'
import { ModelRowView } from './model-rows.tsx'
import { PaneSplitter, usePaneLayout } from './pane.tsx'
import { registryLayerLabel } from './registry-model.ts'
import {
  emptyReasonOf,
  kindNoun,
  layerCountsOf,
  modelsRowsOf,
  relationTagClass,
  resolveFocusTarget,
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
import type { AliasChainState, AliasCopyStatus } from './alias-detail.ts'
import type { AddModelDraft, ModelWriteUi } from './model-detail.ts'
import type {
  ModelRow,
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
  /** 重映射预览里用户选择的 target；null = 跟当前目标。票 64 只读预览。 */
  readonly remapTarget: string | null
  /** 新增模型条目的表单是否展开（票 66）。 */
  readonly addOpen: boolean
  /** 新增表单草稿；切空间 / 切类别时清空。 */
  readonly addDraft: AddModelDraft
  /** 删除条目的二次确认是否展开（票 66）。 */
  readonly deleteConfirm: boolean
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
  remapTarget: null,
  addOpen: false,
  addDraft: EMPTY_ADD_MODEL_DRAFT,
  deleteConfirm: false,
}

export type ModelsPagePatch = Partial<Pick<ModelsPageState, 'space' | 'kind' | 'text' | 'sort' | 'direction' | 'onlyIssues' | 'detailOpen' | 'remapTarget' | 'addOpen' | 'addDraft' | 'deleteConfirm'>>

export interface ModelsPageViewProps {
  readonly snapshot: ControlSnapshot
  readonly state: ModelsPageState
  onState(patch: ModelsPagePatch): void
  onSelect(selection: RegistrySelection): void
  /** 按需读面（POST /agent-atelier/chain）的当前别名报告；缺省 = 未读取。 */
  readonly chain?: AliasChainState | undefined
  /** 复制名称的反馈，只对当前别名有意义。 */
  readonly copied?: AliasCopyStatus | undefined
  readonly onCopyName?: (() => void) | undefined
  readonly onRetryChain?: (() => void) | undefined
  readonly onRequestFocus?: ((focus: PanelFocus, destination?: RegistryDestination) => void) | undefined
  /** 写结果反馈（票 62 的词表）；缺省 = 没有写入进行。 */
  readonly write?: ModelWriteUi | undefined
  /** 写通道在途：禁用开关 / 删除 / 新增提交。 */
  readonly writeBusy?: boolean | undefined
  readonly onToggleAvailable?: ((row: ModelRow, available: boolean) => void) | undefined
  readonly onDeleteModel?: ((row: ModelRow) => void) | undefined
  readonly onAddModel?: ((draft: AddModelDraft) => void) | undefined
}

/** 受控视图：所有状态由外部传入，SSR / 组件测试直接按状态渲染。 */
export function ModelsPageView(props: ModelsPageViewProps): ReactNode {
  const { snapshot, state } = props
  const projectAvailable = snapshot.scope.projectRoot !== null
  // 页面与 chunk 入口共用 modelsRowsOf：工作区不可用时已回退合并，选中已落地。
  const page = useMemo(() => modelsRowsOf(snapshot, state), [snapshot, state])
  const { space, allRows, rows, selection, selectedRow } = page
  const selectedKey = selection === null ? null : selectionKey(selection, space)
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
            state.kind === 'model' && props.onAddModel !== undefined
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: state.addOpen ? 'btn btn-sm btn-primary' : 'btn btn-sm',
                    'data-add-model': '1',
                    'aria-expanded': state.addOpen,
                    disabled: props.writeBusy === true,
                    onClick: () => props.onState({ addOpen: !state.addOpen }),
                  },
                  state.addOpen ? '取消新增' : '新增模型条目',
                )
              : null,
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
            snapshot,
            space,
            selectedRow,
            counts,
            chain: props.chain,
            copied: props.copied ?? 'idle',
            remapTarget: state.remapTarget,
            addOpen: state.addOpen,
            addDraft: state.addDraft,
            deleteConfirm: state.deleteConfirm,
            write: props.write,
            writeBusy: props.writeBusy === true,
            onState: props.onState,
            onCopyName: props.onCopyName,
            onRetryChain: props.onRetryChain,
            onRemapTarget: (name: string) => props.onState({ remapTarget: name }),
            onToggleAvailable: props.onToggleAvailable,
            onDeleteModel: props.onDeleteModel,
            onAddModel: props.onAddModel,
            onRequestFocus: props.onRequestFocus,
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
  readonly snapshot: ControlSnapshot
  readonly space: RegistrySpace
  readonly selectedRow: RegistryRow | null
  readonly counts: LayerCounts
  readonly chain: AliasChainState | undefined
  readonly copied: AliasCopyStatus
  readonly remapTarget: string | null
  readonly addOpen: boolean
  readonly addDraft: AddModelDraft
  readonly deleteConfirm: boolean
  readonly write?: ModelWriteUi | undefined
  readonly writeBusy: boolean
  readonly onState: (patch: ModelsPagePatch) => void
  readonly onCopyName?: (() => void) | undefined
  readonly onRetryChain?: (() => void) | undefined
  readonly onRemapTarget?: ((name: string) => void) | undefined
  readonly onToggleAvailable?: ((row: ModelRow, available: boolean) => void) | undefined
  readonly onDeleteModel?: ((row: ModelRow) => void) | undefined
  readonly onAddModel?: ((draft: AddModelDraft) => void) | undefined
  readonly onRequestFocus?: ((focus: PanelFocus, destination?: RegistryDestination) => void) | undefined
  readonly onClose: () => void
}

const IDLE_CHAIN: AliasChainState = { status: 'idle' }

/** 复制按钮的反馈文案。 */
function copyLabel(status: AliasCopyStatus): string {
  if (status === 'copied') return '已复制'
  if (status === 'failed') return '复制失败'
  return '复制名称'
}

/**
 * 详情壳：身份与层事实（票 63）；别名正文（池 / 链诊断 / fan-in / 影响预览，
 * 票 64）；模型条目的字段编辑归票 66。链报告缺席时正文按「未读取」渲染。
 */
function ModelDetailPane(props: ModelDetailPaneProps): ReactNode {
  const row = props.selectedRow
  const relationClass = row === null ? null : relationTagClass(row.layer.kind)
  return h(
    'section',
    { className: 'model-detail', 'aria-label': '条目详情' },
    h(
      'div',
      { className: 'model-detail-head' },
      props.addOpen
        ? h(
            Fragment,
            null,
            h('span', { className: 'tag tag-scope' }, '新增'),
            h('span', { className: 'model-detail-name' }, '新增模型条目'),
            h('span', { className: 'tag tag-dim' }, spaceLabel(props.space)),
          )
        : row === null
          ? h('span', { className: 'model-detail-name dim' }, '未选择条目')
          : h(
              Fragment,
              null,
              h('span', { className: 'tag tag-scope' }, kindNoun(row.kind)),
              h('span', { className: 'model-detail-name', title: row.name }, row.name),
              h('span', { className: 'tag ' + sourceTagClass(row.source) }, registryLayerLabel(row.source)),
              relationClass === null ? null : h('span', { className: 'tag ' + relationClass }, row.layer.label),
              row.kind === 'alias'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-sm model-detail-copy',
                      'data-copy': 'alias',
                      'aria-label': '复制别名 ' + row.name,
                      onClick: props.onCopyName,
                    },
                    copyLabel(props.copied),
                  )
                : null,
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
      props.addOpen
        ? h(AddModelForm, {
            spaceName: spaceLabel(props.space),
            draft: props.addDraft,
            check: addModelCheckOf(props.snapshot, props.space, props.addDraft),
            write: props.write,
            writeBusy: props.writeBusy,
            onDraftChange: (patch: Partial<AddModelDraft>) => props.onState({ addDraft: { ...props.addDraft, ...patch } }),
            onSubmit: props.onAddModel === undefined ? undefined : () => props.onAddModel?.(props.addDraft),
            onCancel: () => props.onState({ addOpen: false }),
          })
        : row === null
          ? h(
              'div',
              { className: 'model-detail-empty' },
              h('div', { className: 'model-empty-title' }, '未选择条目'),
              h('p', { className: 'dim' }, '在左侧选择别名或模型条目，查看层与关联摘要。'),
            )
          : row.kind === 'alias'
            ? h(AliasDetailBody, {
                snapshot: props.snapshot,
                row,
                space: props.space,
                chain: props.chain ?? IDLE_CHAIN,
                remapTarget: props.remapTarget,
                onRetryChain: props.onRetryChain,
                onRemapTarget: props.onRemapTarget,
                onRequestFocus: props.onRequestFocus,
              })
            : h(ModelDetailBody, {
                snapshot: props.snapshot,
                row,
                space: props.space,
                spaceName: spaceLabel(props.space),
                write: props.write,
                writeBusy: props.writeBusy,
                deleteConfirm: props.deleteConfirm,
                onToggleAvailable: props.onToggleAvailable === undefined
                  ? undefined
                  : (available: boolean) => props.onToggleAvailable?.(row, available),
                onRequestDelete: props.onDeleteModel === undefined
                  ? undefined
                  : () => props.onState({ deleteConfirm: true }),
                onConfirmDelete: () => {
                  props.onState({ deleteConfirm: false })
                  props.onDeleteModel?.(row)
                },
                onCancelDelete: () => props.onState({ deleteConfirm: false }),
                onRequestFocus: props.onRequestFocus,
              }),
      row === null
        ? h(
            'div',
            { className: 'model-empty-summary' },
            '合并后 ' + props.counts.mergedModels + ' 个模型 / ' + props.counts.mergedAliases + ' 个别名 · ',
            '工作区 ' + (props.counts.projectAvailable ? props.counts.projectModels + ' / ' + props.counts.projectAliases : '不可用') + ' · ',
            '用户 ' + props.counts.userModels + ' / ' + props.counts.userAliases,
          )
        : null,
    ),
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
  const [write, setWrite] = useState<ModelWriteUi>({ status: 'idle' })
  const applyState = (patch: ModelsPagePatch): void => {
    // 切空间 / 切类别会换写入层与表单语义：关闭新增与删除确认，草稿清空。
    if (patch.space !== undefined || patch.kind !== undefined) {
      setWrite({ status: 'idle' })
      setState((previous) => ({
        ...previous,
        ...patch,
        addOpen: false,
        addDraft: EMPTY_ADD_MODEL_DRAFT,
        deleteConfirm: false,
      }))
      return
    }
    setState((previous) => ({ ...previous, ...patch }))
  }
  const select = (selection: RegistrySelection): void => {
    setWrite({ status: 'idle' })
    setState((previous) => ({
      ...previous,
      selected: selection,
      detailOpen: true,
      remapTarget: null,
      addOpen: false,
      deleteConfirm: false,
    }))
  }

  const page = useMemo(() => modelsRowsOf(props.snapshot, state), [props.snapshot, state])
  const aliasName = page.selectedRow?.kind === 'alias' ? page.selectedRow.name : null
  const chainAgent = page.selectedRow?.kind === 'alias' ? page.selectedRow.users[0] : undefined

  // 按需读面：别名详情按「第一个使用方」读一次解析报告；切选中 / 回读会中止
  // 上一请求。切换瞬间仍拿到旧报告时，视图按 chainForAlias 当未读取处理。
  const [chain, setChain] = useState<AliasChainState>({ status: 'idle' })
  const [chainAttempt, setChainAttempt] = useState(0)
  const chainHandler = props.onChainReport
  useEffect(() => {
    if (chainHandler === undefined || aliasName === null || chainAgent === undefined) {
      setChain({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setChain({ status: 'loading', alias: aliasName, agent: chainAgent })
    chainHandler(chainAgent, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setChain({
          status: 'ready',
          alias: aliasName,
          agent: chainAgent,
          report: result.report,
          exhausted: result.exhausted,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setChain({ status: 'error', alias: aliasName, agent: chainAgent, message: errorMessage(error) })
      })
    return () => controller.abort()
  }, [chainHandler, aliasName, chainAgent, chainAttempt, props.snapshot])

  // 复制名称：浏览器剪贴板缺失时给失败反馈，不静默。
  const [copy, setCopy] = useState<{ readonly name: string; readonly status: AliasCopyStatus } | null>(null)
  const copyName = (): void => {
    if (aliasName === null) return
    const clipboard = globalThis.navigator?.clipboard
    if (clipboard === undefined) {
      setCopy({ name: aliasName, status: 'failed' })
      return
    }
    void clipboard.writeText(aliasName)
      .then(() => setCopy({ name: aliasName, status: 'copied' }))
      .catch(() => setCopy({ name: aliasName, status: 'failed' }))
  }
  const copied: AliasCopyStatus =
    copy !== null && aliasName !== null && copy.name === aliasName ? copy.status : 'idle'

  // 写动作统一走页面的单一写通道（票 62）：这里是唯一的 in-flight 状态来源，
  // 写失败是结果行而不是异常；只有 abort 会 reject。
  const runWrite = (edits: readonly RegistryEdit[], label: string, afterOk?: () => void): void => {
    const handler = props.onRegistryWrite
    if (handler === undefined) return
    setWrite({ status: 'writing', label })
    handler(edits)
      .then((outcome) => {
        setWrite({ status: 'done', outcome })
        if (outcome.changedCount > 0) afterOk?.()
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          setWrite({ status: 'idle' })
          return
        }
        setWrite({ status: 'error', message: errorMessage(error) })
      })
  }

  const toggleAvailable = (row: ModelRow, available: boolean): void => {
    runWrite([setAvailableEditOf(row, available)], '更新 ' + row.name + ' 的 available')
  }

  const deleteModel = (row: ModelRow): void => {
    runWrite([deleteModelEditOf(row)], '删除 ' + row.name, () => {
      setState((previous) => ({ ...previous, deleteConfirm: false, selected: null }))
    })
  }

  const addModel = (draft: AddModelDraft): void => {
    const check = addModelCheckOf(props.snapshot, page.space, draft)
    if (!check.canSubmit || check.target === undefined) return
    const name = draft.name.trim()
    // 写后回读会让新行进入快照；选中先指向它，回读完成后详情自动接上。
    setState((previous) => ({ ...previous, selected: { kind: 'model', name } }))
    runWrite([buildAddModelEdit(check.target, draft)], '新增 ' + name, () => {
      setState((previous) => ({
        ...previous,
        addOpen: false,
        addDraft: EMPTY_ADD_MODEL_DRAFT,
        deleteConfirm: false,
        selected: { kind: 'model', name },
      }))
    })
  }

  // 跨页聚焦：目标在当前空间找不到时切合并空间（票 60 的裁决），找到才消费；
  // 目标还没进快照就不消费，等下一份快照再试。
  useEffect(() => {
    const focus = props.focus
    if (focus === null || focus === undefined) return
    const target = resolveFocusTarget(focus, props.snapshot, state.space)
    if (target === null) return
    setWrite({ status: 'idle' })
    setState((previous) => ({
      ...previous,
      space: target.space,
      kind: target.kind,
      text: '',
      onlyIssues: false,
      selected: { kind: target.kind, name: target.name },
      detailOpen: true,
      remapTarget: null,
      addOpen: false,
      addDraft: EMPTY_ADD_MODEL_DRAFT,
      deleteConfirm: false,
    }))
    props.onFocusConsumed?.()
  }, [props.focus, props.snapshot, state.space, props.onFocusConsumed])

  return h(ModelsPageView, {
    snapshot: props.snapshot,
    state,
    onState: applyState,
    onSelect: select,
    chain,
    copied,
    onCopyName: copyName,
    onRetryChain: () => setChainAttempt((attempt) => attempt + 1),
    write,
    writeBusy: props.registryWriteBusy === true || write.status === 'writing',
    onToggleAvailable: props.onRegistryWrite === undefined ? undefined : toggleAvailable,
    onDeleteModel: props.onRegistryWrite === undefined ? undefined : deleteModel,
    onAddModel: props.onRegistryWrite === undefined ? undefined : addModel,
    onRequestFocus: props.onRequestFocus,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
