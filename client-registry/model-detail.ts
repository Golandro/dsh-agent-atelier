/**
 * 模型条目详情的纯投影（票 66）：可用性事实、引用 / 可达、删除门禁、新增
 * 校验与写结果词表。无 React、无 IO；宿主已解析的快照是唯一输入。
 *
 * 这里的「组折叠」只读现有声明，用于注明触发条目；折叠本身已由装载期完成
 * （#35），本模块不再判一遍可用性。删除 / 新增只产出 RegistryEdit，真正落盘
 * 仍走页面的单一写通道（票 62）。
 */
import type { ControlSnapshot, RegistryEdit } from '../src/control/index.ts'
import type { RegistryWriteOutcome } from '../src/dsh/client/chunk-contracts.ts'
import { registryLayerLabel } from './registry-model.ts'

import type { LayerRef, ModelRow, RegistrySource, RegistrySpace } from './registry-model.ts'

/** 指向条目的生效别名（含内置指针）。 */
export type ModelAliasRef = ModelRow['aliases'][number]
/** 同线路的其它生效别名。 */
export type ModelFanInRef = ModelRow['fanIn'][number]

/** 一条模型条目的可用性事实：声明值、生效值与声明层。 */
export interface ModelAvailabilityFacts {
  /** 本条声明里的 available（raw 层声明或合并赢家声明）。 */
  readonly declared: boolean
  readonly declaredLayer: RegistrySource
  readonly declaredPath?: string | undefined
  /** 合并快照里的 available（装载期已折叠组开关）。 */
  readonly effective: boolean
  readonly effectiveLayer: RegistrySource
  readonly effectivePath?: string | undefined
  /** 本行声明就是生效声明：服务端编辑会落在这一行对应的层文件。 */
  readonly editable: boolean
  readonly readOnly: boolean
  /** 生效值为 false、但本条声明是 true：被组级开关折叠。 */
  readonly folded: boolean
  readonly group: string
  /** 把整组折成停用的条目名（按合并快照里的声明值求值）。 */
  readonly triggers: readonly string[]
}

/** 声明值来自哪一层：registryLayers 最高优先级在前，先命中的层就是赢家。 */
function declaredAvailableOf(snapshot: ControlSnapshot, modelName: string, fallback: boolean): boolean {
  for (const layer of snapshot.registryLayers) {
    const declaration = layer.models.find((model) => model.modelName === modelName)
    if (declaration !== undefined) return declaration.available
  }
  return fallback
}

/**
 * 同一 modelGroup 里声明 available:false 的条目。只在组折叠时调用；它解释
 * 「由哪条触发」，不参与是否可用的判定（宿主已经折叠）。
 */
export function groupTriggerNamesOf(snapshot: ControlSnapshot, row: ModelRow): readonly string[] {
  if (!row.groupFolded) return []
  const members = snapshot.models.filter((model) => (model.modelGroup ?? model.modelName) === row.group)
  return members
    .filter((model) => !declaredAvailableOf(snapshot, model.modelName, model.available))
    .map((model) => model.modelName)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

/** 详情头 / 可用开关区共用的一组事实。 */
export function availabilityFactsOf(snapshot: ControlSnapshot, row: ModelRow): ModelAvailabilityFacts {
  return {
    declared: row.declaredAvailable,
    declaredLayer: row.source,
    ...(row.path === undefined ? {} : { declaredPath: row.path }),
    effective: row.available,
    effectiveLayer: row.effective.source,
    ...(row.effective.path === undefined ? {} : { effectivePath: row.effective.path }),
    editable: !row.readOnly && row.source === row.effective.source,
    readOnly: row.readOnly,
    folded: row.groupFolded,
    group: row.group,
    triggers: groupTriggerNamesOf(snapshot, row),
  }
}

/** 同一线路里不重复计入「指向本条目的别名」的那些别名。 */
export function fanInOthersOf(row: ModelRow): readonly ModelFanInRef[] {
  return row.fanIn.filter((alias) => !row.aliases.some((pointer) => pointer.alias === alias.alias))
}

/** 生效的系统提示词：模型详情预览的是运行时生效值，不重放层合并。 */
export function modelPromptOf(row: ModelRow): string | undefined {
  return row.effective.sysPrompt
}

/* ── 删除门禁 ─────────────────────────────────────────────────────── */

export type ModelDeleteBlock = 'read-only' | 'covered' | 'referenced'

/**
 * 删除门禁（票 66 范围 5）：
 * - 内置 / 合成只读，不提供删除；
 * - 被更高层覆盖的声明不提供删除（服务端编辑只会改生效声明那一层）；
 * - 有引用且有更低层同名声明：允许，注明「由下层接管」；
 * - 有引用且没有下层：拒绝，改列引用；
 * - 无引用：允许，二次确认。
 */
export interface ModelDeleteGate {
  readonly allowed: boolean
  readonly block?: ModelDeleteBlock | undefined
  readonly reason?: string | undefined
  /** 指向本条目的生效别名；拒绝 / 接管时都给 UI 展示。 */
  readonly refs: readonly ModelAliasRef[]
  /** 删除后接管的下一条声明（由行模型给出）。 */
  readonly takeover?: LayerRef | undefined
  /** 删除会改写的层文件。 */
  readonly file?: string | undefined
  /** 允许删除时始终要求确认；确认面板同时显示接管 / 引用信息。 */
  readonly needsConfirm: boolean
}

export function deleteGateOf(row: ModelRow): ModelDeleteGate {
  const refs = row.aliases
  const takeover = row.layer.takeover
  const file = row.effective.path ?? row.path
  const base = {
    refs,
    ...(takeover === undefined ? {} : { takeover }),
    ...(file === undefined ? {} : { file }),
  }
  if (row.readOnly) {
    return {
      ...base,
      allowed: false,
      block: 'read-only',
      reason: row.synthesized ? '合成条目只读，不能删除。' : '内置条目只读，不能删除。',
      needsConfirm: false,
    }
  }
  if (row.source !== row.effective.source) {
    return {
      ...base,
      allowed: false,
      block: 'covered',
      reason: '本条声明被 ' + registryLayerLabel(row.effective.source) + ' 接管；删除只能在合并视图对生效声明执行。',
      needsConfirm: false,
    }
  }
  if (refs.length > 0 && takeover === undefined) {
    return {
      ...base,
      allowed: false,
      block: 'referenced',
      reason: '被 ' + String(refs.length) + ' 个别名引用，且没有更低层同名声明可接管；删除会让别名悬空。',
      needsConfirm: false,
    }
  }
  return { ...base, allowed: true, needsConfirm: true }
}

/** 删除一笔：目标由宿主按生效声明解析。 */
export function deleteModelEditOf(row: ModelRow): RegistryEdit {
  return { kind: 'deleteModel', modelName: row.name }
}

/** 单条 available 开关的一笔。 */
export function setAvailableEditOf(row: ModelRow, available: boolean): RegistryEdit {
  return { kind: 'setAvailable', modelName: row.name, available }
}

/* ── 新增模型条目 ────────────────────────────────────────────────── */

/** addModel 的层来源；合并视图落工作区（无项目根时禁写）。 */
export type AddModelLayerSource = Extract<RegistryEdit, { kind: 'addModel' }>['source']

/** 表单草稿；空表单的默认值。 */
export interface AddModelDraft {
  readonly name: string
  readonly provider: string
  readonly model: string
  readonly sysPrompt: string
  readonly available: boolean
}

export const EMPTY_ADD_MODEL_DRAFT: AddModelDraft = {
  name: '',
  provider: '',
  model: '',
  sysPrompt: '',
  available: true,
}

/**
 * registry 条目名的字符集，与服务端 src/control/registry-edit.ts 的 NAME_RE 一致；
 * 服务端仍是最终裁决，这里只做即时提示，避免一次无谓往返。
 */
export const MODEL_ENTRY_NAME_RE = /^[A-Za-z0-9_.-]+$/

export interface AddModelTarget {
  readonly source: AddModelLayerSource
  readonly label: string
  readonly path?: string | undefined
}

export type AddModelProblemField = 'space' | 'name' | 'provider' | 'model'

export interface AddModelProblem {
  readonly field: AddModelProblemField
  readonly message: string
}

export interface AddModelCheck {
  readonly target?: AddModelTarget | undefined
  readonly problems: readonly AddModelProblem[]
  readonly canSubmit: boolean
}

/** 当前空间对应的写入层：合并 / 工作区 => 工作区层；用户 => 用户层。 */
export function addModelTargetOf(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
): { readonly target?: AddModelTarget; readonly problem?: AddModelProblem } {
  if (space === 'merged' && snapshot.scope.projectRoot === null) {
    return {
      problem: {
        field: 'space',
        message: '合并视图的新增会写入工作区层；当前没有项目根（用户全局），不能新增模型条目。',
      },
    }
  }
  if (space === 'project' && snapshot.scope.projectRoot === null) {
    return { problem: { field: 'space', message: '当前没有项目根，工作区层不可写。' } }
  }
  const source: AddModelLayerSource = space === 'user' ? 'user-dsh' : 'project-dsh'
  const layer = snapshot.registryLayers.find((candidate) => candidate.source === source)
  return {
    target: {
      source,
      label: registryLayerLabel(source),
      ...(layer?.path === undefined ? {} : { path: layer.path }),
    },
  }
}

function layerModelsOf(snapshot: ControlSnapshot, source: AddModelLayerSource) {
  return snapshot.registryLayers.find((layer) => layer.source === source)?.models ?? []
}

/** 表单的即时校验；写回前构造 RegistryEdit 仍以服务端校验为准。 */
export function addModelCheckOf(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  draft: AddModelDraft,
): AddModelCheck {
  const resolution = addModelTargetOf(snapshot, space)
  const problems: AddModelProblem[] = resolution.problem === undefined ? [] : [resolution.problem]
  const target = resolution.target
  const name = draft.name.trim()

  if (name === '') problems.push({ field: 'name', message: '模型条目名必填。' })
  else if (!MODEL_ENTRY_NAME_RE.test(name)) {
    problems.push({ field: 'name', message: '名称只允许字母、数字、下划线、点与短横线（与 registry 条目名一致）。' })
  } else if (target !== undefined && layerModelsOf(snapshot, target.source).some((model) => model.modelName === name)) {
    problems.push({ field: 'name', message: target.label + '已有同名模型条目「' + name + '」。' })
  }

  if (draft.provider.trim() === '') problems.push({ field: 'provider', message: 'provider 必填。' })
  if (draft.model.trim() === '') problems.push({ field: 'model', message: 'model 必填。' })

  return {
    ...(target === undefined ? {} : { target }),
    problems,
    canSubmit: problems.length === 0,
  }
}

/** 草稿 → addModel 编辑；sysPrompt 为空表示不声明。 */
export function buildAddModelEdit(target: AddModelTarget, draft: AddModelDraft): RegistryEdit {
  const sysPrompt = draft.sysPrompt.trim() === '' ? undefined : draft.sysPrompt
  return {
    kind: 'addModel',
    modelName: draft.name.trim(),
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    ...(sysPrompt === undefined ? {} : { sysPrompt }),
    available: draft.available,
    source: target.source,
  }
}

/* ── 写结果词表 ──────────────────────────────────────────────────── */

/** 模型详情 / 新增表单共用的写入状态；IO 由页面层持有。 */
export type ModelWriteUi =
  | { readonly status: 'idle' }
  | { readonly status: 'writing'; readonly label: string }
  | { readonly status: 'done'; readonly outcome: RegistryWriteOutcome }
  | { readonly status: 'error'; readonly message: string }

export interface ModelWriteLine {
  readonly tone: 'ok' | 'warn' | 'err'
  readonly text: string
}

export function writeHeadlineOf(outcome: RegistryWriteOutcome): string {
  if (outcome.status === 'busy') return '写入未发送'
  if (outcome.status === 'failed') return '写入失败'
  if (outcome.status === 'partial') return '部分写入（' + String(outcome.changedCount) + ' 笔成功）'
  return '已写入（' + String(outcome.changedCount) + ' 笔）'
}

export function writeToneOf(outcome: RegistryWriteOutcome): 'ok' | 'warn' | 'err' {
  if (outcome.status === 'failed' || outcome.reloadError !== undefined) return 'err'
  if (outcome.status === 'partial' || outcome.status === 'busy') return 'warn'
  return 'ok'
}

/** 成功行、失败行与回读结果各占一行；宿主消息原样展示。 */
export function writeLinesOf(outcome: RegistryWriteOutcome): readonly ModelWriteLine[] {
  const lines: ModelWriteLine[] = []
  for (const row of outcome.rows) {
    if (row.ok) lines.push({ tone: 'ok', text: '已写入 ' + (row.file ?? '（宿主未返回文件）') })
    else lines.push({ tone: 'err', text: '写入失败（' + row.code + '）：' + row.message })
  }
  if (outcome.status === 'busy') {
    lines.push({ tone: 'warn', text: '另一次 registry 写入还在进行，本次没有发送。' })
  }
  if (outcome.status === 'failed' && outcome.rows.length === 0) {
    lines.push({ tone: 'err', text: '写入失败，宿主没有返回结果行。' })
  }
  if (outcome.reloadError !== undefined) {
    lines.push({ tone: 'warn', text: '写入已落盘，但回读失败：' + outcome.reloadError })
  } else if (outcome.changedCount > 0 && outcome.status !== 'busy') {
    lines.push({ tone: 'ok', text: '写后快照已回读。' })
  }
  return lines
}
