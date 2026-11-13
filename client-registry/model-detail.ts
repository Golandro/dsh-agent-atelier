/**
 * 模型条目详情的纯投影（票 66 / 67）：可用性事实、组成员与整组开关计划、
 * 引用 / 可达、删除门禁、新增校验与写结果词表。无 React、无 IO；宿主已解析
 * 的快照是唯一输入。
 *
 * 这里的「组折叠」只读现有声明，用于注明触发条目；折叠本身已由装载期完成
 * （#35），本模块不再判一遍可用性。删除 / 新增只产出 RegistryEdit，真正落盘
 * 仍走页面的单一写通道（票 62）。
 */
import type { ControlSnapshot, RegistryEdit } from '../src/control/index.ts'
import type { RegistryWriteOutcome } from '../src/dsh/client/chunk-contracts.ts'
import { declaredAvailableOf, layerSourceOf, registryLayerLabel, routeKey } from './registry-model.ts'

import type { LayerRef, ModelRow, RegistrySource, RegistrySpace } from './registry-model.ts'

/** 指向条目的生效别名（含内置指针）。 */
export type ModelAliasRef = ModelRow['aliases'][number]
/** 同线路的其它生效别名。 */
export type ModelFanInRef = ModelRow['fanIn'][number]

/** 一条模型条目的可用性事实：声明值、生效值与声明层。 */
export interface ModelAvailabilityFacts {
  /**
   * 本条声明里的 available（raw 层声明或合并赢家声明）；内置 / 合成条目没有
   * 层声明，读作 undefined。
   */
  readonly declared: boolean | undefined
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
  /** 生效组键（合并赢家的 modelGroup ?? modelName）；折叠按这一组求值。 */
  readonly group: string
}

/**
 * 详情里的生效组键：合并赢家声明的 modelGroup ?? modelName。层空间的 raw
 * 声明可能被覆盖，组折叠必须按生效组求值。
 */
export function effectiveGroupOf(row: ModelRow): string {
  return row.effective.modelGroup ?? row.effective.modelName
}

/** 详情头 / 可用开关区共用的一组事实；折叠触发者由组成员区同一份投影给出。 */
export function availabilityFactsOf(row: ModelRow): ModelAvailabilityFacts {
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
    group: effectiveGroupOf(row),
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

/* ── 组成员与整组开关 ────────────────────────────────────────────── */

/**
 * 组员事实（按合并生效面求值）。
 *
 * `declaredAvailable` 只读层声明：内置 / 合成条目没有可读的层声明，读作
 * undefined，绝不拿已折叠的生效值顶替——否则被组折叠的只读条目会冒充触发者。
 */
export interface GroupMemberFacts {
  readonly name: string
  readonly route: string
  readonly declaredAvailable: boolean | undefined
  readonly effective: boolean
  readonly declaredLayer: RegistrySource
  readonly declaredPath?: string | undefined
  readonly readOnly: boolean
  /** 本空间写入这一条会落在生效声明所在文件。 */
  readonly editable: boolean
  /** 声明可读且为 false：整组停用的触发者。 */
  readonly trigger: boolean
}

/** 组成员与整组可用性；折叠已由宿主完成，这里只做投影。 */
export interface ModelGroupFacts {
  readonly name: string
  /** 本条在合并快照里的 available（宿主已折叠整组）。 */
  readonly available: boolean
  readonly triggers: readonly string[]
  /** 声明不可读的组员名（内置 / 合成）。 */
  readonly opaque: readonly string[]
  readonly members: readonly GroupMemberFacts[]
}

/** 组内声明可读且为 false 的条目：唯一能解释折叠的触发者。 */
function triggersOf(members: readonly GroupMemberFacts[]): readonly string[] {
  return members
    .filter((member) => member.trigger)
    .map((member) => member.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

function groupMemberOf(
  snapshot: ControlSnapshot,
  spaceSource: RegistrySource | undefined,
  model: ControlSnapshot['models'][number],
): GroupMemberFacts {
  const declaredAvailable = declaredAvailableOf(snapshot, model.modelName)
  const readOnly = model.source === 'built-in' || model.synthesized === true
  return {
    name: model.modelName,
    route: routeKey(model),
    declaredAvailable,
    effective: model.available,
    declaredLayer: model.source,
    ...(model.path === undefined ? {} : { declaredPath: model.path }),
    readOnly,
    editable: !readOnly && (spaceSource === undefined || model.source === spaceSource),
    trigger: declaredAvailable === false,
  }
}

/**
 * 同组成员的完整投影。合并空间所有非只读条目都可写；工作区 / 用户空间只
 * 能写生效声明落在本层的那一条（与单条开关的 editable 口径一致）。
 */
export function modelGroupFactsOf(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  row: ModelRow,
): ModelGroupFacts {
  const name = effectiveGroupOf(row)
  const spaceSource = layerSourceOf(space)
  const members = snapshot.models
    .filter((model) => (model.modelGroup ?? model.modelName) === name)
    .map((model) => groupMemberOf(snapshot, spaceSource, model))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  return {
    name,
    available: row.available,
    triggers: triggersOf(members),
    opaque: members.filter((member) => member.declaredAvailable === undefined).map((member) => member.name),
    members,
  }
}

export type ModelGroupAction = 'close' | 'open'

/** 整组动作的计划：多笔 setAvailable，串行交给页面写通道。 */
export interface ModelGroupTogglePlan {
  readonly action: ModelGroupAction
  readonly group: string
  readonly edits: readonly RegistryEdit[]
  readonly blocked?: string | undefined
  readonly note?: string | undefined
}

function namesOf(members: readonly GroupMemberFacts[]): string {
  return members.map((member) => member.name).join(' / ')
}

/**
 * 整组关闭 / 开启的计划。折叠规则（任一条 false ⇒ 整组 false）由宿主执行，
 * 这里只按「声明值」决定写哪几条：
 * - 关闭：写组内可写且声明 true 的条目。写一条已足够让整组停用，逐条写是为了
 *   单条被重新开启后整组仍保持停用；写不到的组员保持原值并注明。
 * - 开启：清掉全部声明 false 的条目。只要有一条停用声明在本空间写不到，整组
 *   就开不起来——直接拦下并指向合并视图，不写半批。
 *
 * 内置 / 合成条目恒为 available:true（宿主合成时就写死），因此只读组员永远
 * 不是触发者；拦截文案里的「写不到」只会指向更高层的声明。
 */
export function groupTogglePlanOf(facts: ModelGroupFacts, action: ModelGroupAction): ModelGroupTogglePlan {
  const triggers = facts.members.filter((member) => member.trigger)
  if (action === 'open') {
    if (triggers.length === 0) {
      return { action, group: facts.name, edits: [], blocked: '组内没有声明 available:false 的条目，整组已经可用。' }
    }
    const locked = triggers.filter((member) => !member.editable)
    if (locked.length > 0) {
      return {
        action,
        group: facts.name,
        edits: [],
        blocked: '组内 ' + namesOf(locked) + ' 的停用声明在更高层，本空间写不到；请切到合并视图再开启整组。',
      }
    }
    return {
      action,
      group: facts.name,
      edits: triggers.map((member) => ({ kind: 'setAvailable', modelName: member.name, available: true })),
      ...(triggers.length === 1
        ? {}
        : { note: '开启要清掉全部 ' + String(triggers.length) + ' 条 false 声明；任一条残留都会把整组折成停用。' }),
    }
  }
  const targets = facts.members.filter((member) => member.editable && member.declaredAvailable === true)
  const skipped = facts.members.filter((member) => !member.editable && member.declaredAvailable === true)
  if (targets.length === 0) {
    return {
      action,
      group: facts.name,
      edits: [],
      blocked: skipped.length === 0
        ? '组内没有声明可用的条目，整组已经停用。'
        : '组内 ' + namesOf(skipped) + ' 的声明在本空间不可写；请切到合并视图再关整组。',
    }
  }
  return {
    action,
    group: facts.name,
    edits: targets.map((member) => ({ kind: 'setAvailable', modelName: member.name, available: false })),
    note: '写 ' + namesOf(targets) + ' 的 available:false；单条声明即足以让整组停用，逐条写是为了单条重开后整组仍保持停用。' +
      (skipped.length === 0 ? '' : '另有 ' + namesOf(skipped) + ' 在本空间不可写，本次不写入。'),
  }
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
