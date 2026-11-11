/**
 * 模型关联页的列表状态与展示词（票 63）——纯函数，无 React、无 IO。
 *
 * 这里只做「宿主已解析快照 → 页面状态」的投影：行来自 registry-model 的
 * buildRegistryRows（不重跑层合并），搜索/排序走同一份 evaluateRegistryQuery；
 * 本模块负责空间可用性、切空间后的选中规则、聚焦目标定位与空态判定。
 */
import type { PanelFocus } from '../src/dsh/client/chunk-contracts.ts'
import type { ControlSnapshot } from '../src/control/index.ts'
import {
  buildRegistryRows,
  evaluateRegistryQuery,
  registryLayerLabel,
  rowKey,
} from './registry-model.ts'

import type {
  RegistryKind,
  RegistryLayerSnapshot,
  RegistryListQuery,
  RegistryRow,
  RegistrySpace,
} from './registry-model.ts'

/** 选中的条目身份：空间不属于身份（切空间时同一名字才是同一条目）。 */
export interface RegistrySelection {
  readonly kind: RegistryKind
  readonly name: string
}

export function selectionOfRow(row: RegistryRow): RegistrySelection {
  return { kind: row.kind, name: row.name }
}

export function selectionKey(selection: RegistrySelection, space: RegistrySpace): string {
  return rowKey(selection.kind, space, selection.name)
}

/**
 * 当前列表上真正选中的行——选中规则写死在这里，并由测试固定：
 * 1. 上一选中在本空间同类别的行里仍存在 ⇒ 保留（切空间 / 写后回读不丢选中）；
 * 2. 目标不在新空间 ⇒ 跟到第一条（空间为空才没有选中，由调用方处理）；
 * 3. 切类别 ⇒ 类别不同，按第一条。
 * 关键词与「仅异常」不参与：详情不随筛选消失。
 */
export function effectiveSelection(
  previous: RegistrySelection | null,
  allRows: readonly RegistryRow[],
  visibleRows: readonly RegistryRow[],
  kind: RegistryKind,
): RegistrySelection | null {
  if (allRows.length === 0) return null
  if (previous !== null && previous.kind === kind) {
    const hit = allRows.find((row) => row.kind === kind && row.name === previous.name)
    if (hit !== undefined) return previous
  }
  // 跟第一条按「当前可见列表」的头一行：排序/筛选后的第一行才是用户看到的第一条。
  if (visibleRows.length > 0) return selectionOfRow(visibleRows[0] as RegistryRow)
  // 筛选无命中时详情不随之消失：仍指向全量行的第一条。
  return selectionOfRow(allRows[0] as RegistryRow)
}

/** 上下键步进：当前项不在可见行里时，向下从第一条、向上从最后一条开始。 */
export function stepSelection(
  rows: readonly RegistryRow[],
  currentKey: string | null,
  delta: 1 | -1,
): RegistrySelection | null {
  if (rows.length === 0) return null
  const index = currentKey === null ? -1 : rows.findIndex((row) => row.key === currentKey)
  const next = index < 0
    ? (delta > 0 ? 0 : rows.length - 1)
    : Math.min(rows.length - 1, Math.max(0, index + delta))
  return selectionOfRow(rows[next] as RegistryRow)
}

/** 空间当前层；合并空间没有层。 */
export function layerOf(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
): RegistryLayerSnapshot | undefined {
  if (space === 'merged') return undefined
  const source = space === 'project' ? 'project-dsh' : 'user-dsh'
  return snapshot.registryLayers.find((layer) => layer.source === source)
}

/** 页面的三档空间展示词。 */
export function spaceLabel(space: RegistrySpace): string {
  if (space === 'project') return '工作区'
  if (space === 'user') return '用户'
  return '合并'
}

/** 类别展示词。 */
export function kindNoun(kind: RegistryKind): string {
  return kind === 'alias' ? '别名' : '模型条目'
}

/**
 * 跨页聚焦落点：目标先在当前空间找；当前空间找不到、合并空间找得到时切合并；
 * 哪里都没有 ⇒ null（目标可能还没进快照，页面等下一次快照再消费，不丢弃）。
 * 空间段控归本页，壳层只把 source 随目标传进来；这里不另选层。
 */
export interface FocusTarget {
  readonly space: RegistrySpace
  readonly kind: RegistryKind
  readonly name: string
}

export function resolveFocusTarget(
  focus: PanelFocus,
  snapshot: ControlSnapshot,
  space: RegistrySpace,
): FocusTarget | null {
  if (focus.kind !== 'alias' && focus.kind !== 'model') return null
  const kind = focus.kind
  const inSpace = buildRegistryRows(snapshot, space, kind).some((row) => row.name === focus.name)
  if (inSpace) return { space, kind, name: focus.name }
  if (space !== 'merged' && buildRegistryRows(snapshot, 'merged', kind).some((row) => row.name === focus.name)) {
    return { space: 'merged', kind, name: focus.name }
  }
  return null
}

/** 当前类别在所有空间都没有声明（空态「无 registry」用它，而不是只看当前层）。 */
export function registryEmpty(snapshot: ControlSnapshot, kind: RegistryKind): boolean {
  return kind === 'alias' ? snapshot.aliases.length === 0 : snapshot.models.length === 0
}

/** 空列表的四种原因 + 空间不可用；null = 有可见行。 */
export type RegistryEmptyReason =
  | 'filtered'
  | 'space-unavailable'
  | 'layer-missing'
  | 'layer-empty'
  | 'registry-empty'

export function emptyReasonOf(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  kind: RegistryKind,
  allRows: readonly RegistryRow[],
  visibleRows: readonly RegistryRow[],
): RegistryEmptyReason | null {
  if (visibleRows.length > 0) return null
  if (allRows.length > 0) return 'filtered'
  if (space === 'project' && snapshot.scope.projectRoot === null) return 'space-unavailable'
  const layer = layerOf(snapshot, space)
  if (space !== 'merged' && layer === undefined) return 'layer-missing'
  if (registryEmpty(snapshot, kind)) return 'registry-empty'
  if (space !== 'merged' && layer !== undefined) {
    const declared = kind === 'alias' ? layer.aliases.length : layer.models.length
    if (declared === 0) return 'layer-empty'
  }
  return 'registry-empty'
}

/** 右侧空态与页脚用的分层计数；数字全部来自宿主的层投影，不重算合并。 */
export interface LayerCounts {
  readonly mergedModels: number
  readonly mergedAliases: number
  readonly projectModels: number
  readonly projectAliases: number
  readonly userModels: number
  readonly userAliases: number
  readonly projectAvailable: boolean
}

export function layerCountsOf(snapshot: ControlSnapshot): LayerCounts {
  const project = layerOf(snapshot, 'project')
  const user = layerOf(snapshot, 'user')
  return {
    mergedModels: snapshot.models.length,
    mergedAliases: snapshot.aliases.length,
    projectModels: project?.models.length ?? 0,
    projectAliases: project?.aliases.length ?? 0,
    userModels: user?.models.length ?? 0,
    userAliases: user?.aliases.length ?? 0,
    projectAvailable: snapshot.scope.projectRoot !== null,
  }
}

/** 列表查询的组装：UI 状态 → 唯一求值器。 */
export function registryQueryOf(input: {
  readonly text: string
  readonly sort: NonNullable<RegistryListQuery['sort']>
  readonly direction: 'asc' | 'desc'
  readonly onlyIssues: boolean
}): RegistryListQuery {
  return {
    text: input.text,
    sort: input.sort,
    direction: input.direction,
    onlyIssues: input.onlyIssues,
  }
}

/** 一遍求值：全量行（选中按这一面解析）+ 可见行（列表与计数）。 */
export interface RegistryListState {
  readonly allRows: readonly RegistryRow[]
  readonly rows: readonly RegistryRow[]
}

export function registryListOf(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  kind: RegistryKind,
  query: RegistryListQuery,
): RegistryListState {
  const allRows = buildRegistryRows(snapshot, space, kind)
  return { allRows, rows: evaluateRegistryQuery(allRows, query) }
}

/* ── 行展示词 ───────────────────────────────────────────────────── */

/** 层标签的 CSS 类（样式表里的 .tag-workspace / .tag-user / .tag-bundled）。 */
export function sourceTagClass(source: RegistryRow['source']): string {
  if (source === 'project-dsh') return 'tag-workspace'
  if (source === 'user-dsh') return 'tag-user'
  return 'tag-bundled'
}

/** 遮蔽关系的颜色：覆盖低层用 ok，遮蔽 / 被覆盖用 warn。 */
export function relationTagClass(kind: RegistryRow['layer']['kind']): string | null {
  if (kind === 'covers') return 'tag-ok'
  if (kind === 'shadows' || kind === 'covered') return 'tag-warn'
  return null
}

/** 别名行第一行的目标名：优先当前选中的池条目，其次声明的首目标。 */
export function aliasTargetLabel(row: Extract<RegistryRow, { kind: 'alias' }>): string {
  return row.selectedTarget?.name ?? row.targets[0] ?? '（未声明目标）'
}

/** 行的 provider/model 路线：模型行取声明路线；别名行取目标条目的路线。 */
export function rowRoute(row: RegistryRow): string | undefined {
  if (row.kind === 'model') return row.route
  const selected = row.selectedTarget
  if (selected !== undefined) return selected.route
  const firstTarget = row.targets[0]
  return firstTarget === undefined ? undefined : row.pool.find((entry) => entry.name === firstTarget)?.route
}

/** 引用计数：别名看使用者 agent，模型条目看指向它的别名。 */
export function rowRefCount(row: RegistryRow): number {
  return row.kind === 'alias' ? row.users.length : row.aliases.length
}

export function rowRefLabel(row: RegistryRow): string {
  if (row.kind === 'alias') return row.users.length === 0 ? '未使用' : `Agent ×${row.users.length}`
  return row.aliases.length === 0 ? '无别名' : `别名 ×${row.aliases.length}`
}

/** 行上的状态 tag（悬空 / 停用 / 只读 / 合成），顺序固定。 */
export interface RowTag {
  readonly text: string
  readonly className: string
}

export function rowIssueTags(row: RegistryRow): readonly RowTag[] {
  const tags: RowTag[] = []
  if (row.kind === 'alias') {
    if (row.dangling) tags.push({ text: '悬空', className: 'tag-err' })
    if (row.disabled) tags.push({ text: '目标停用', className: 'tag-warn' })
    if (row.readOnly) tags.push({ text: '内置 · 只读', className: 'tag-bundled' })
    return tags
  }
  if (row.groupFolded) tags.push({ text: '组级停用', className: 'tag-warn' })
  else if (!row.available) tags.push({ text: '停用', className: 'tag-warn' })
  if (row.synthesized) tags.push({ text: '合成', className: 'tag-bundled' })
  else if (row.readOnly) tags.push({ text: '内置 · 只读', className: 'tag-bundled' })
  return tags
}

/** 行第二行的 path 文案：内置与合成条目没有文件。 */
export function rowPathLabel(row: RegistryRow): string {
  if (row.path !== undefined) return row.path
  return row.kind === 'model' && row.synthesized ? '（合成，无文件）' : '（内置，无文件）'
}

/** 行按钮的读屏名：名称、类别、目标/路线、计数与层信息一次读完。 */
export function rowAriaLabel(row: RegistryRow): string {
  const target = row.kind === 'alias' ? aliasTargetLabel(row) : rowRoute(row) ?? '未声明路线'
  const relation = row.layer.label === '' ? '' : `，${row.layer.label}`
  return `${row.name}，${kindNoun(row.kind)}，${target}，${rowRefLabel(row)}，${registryLayerLabel(row.source)}${relation}`
}
