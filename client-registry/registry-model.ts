/**
 * Registry 纯视图模型（票 61）：把模型关联页的行构造、解析谓词、可达面与
 * 影响面收敛成一份无 React、无 host、无 IO 的纯函数。
 *
 * 输入只有宿主已解析的 ControlSnapshot（merged models / aliases /
 * registryLayers / agents）与列表查询；这个模块不重跑层合并，也不调用链
 * 解析引擎。层空间的行来自 registryLayers 的 raw 声明，merged 空间的行来自
 * 合并快照；别名关联（指向、fan-in、触达、影响）在层空间也按合并生效面求值
 * （票 61 裁决 Q3）。
 *
 * 本文件住在 client-registry/ chunk 内，唯一允许的跨层 import 是
 * src/control/index.ts 的 type-only 入口；因此这里用 ControlSnapshot 的投影
 * 类型，而不 import src/contract 的深路径。健康字段是契约 RouteHealth 的结构
 * 镜像：当前 /state wire 不携带健康，缺省读作「未判定」，厚度留给 #66。
 */
import type { ControlSnapshot } from '../src/control/index.ts'

/** 合并快照里的模型条目（结构投影，不依赖 contract 深路径）。 */
export type RegistryModelDefinition = ControlSnapshot['models'][number]
/** 合并快照里的别名。 */
export type RegistryAliasDefinition = ControlSnapshot['aliases'][number]
/** 合并快照里的 agent 定义。 */
export type RegistryAgentDefinition = ControlSnapshot['agents'][number]
/** 宿主投影的一层 registry.yaml raw 声明。 */
export type RegistryLayerSnapshot = ControlSnapshot['registryLayers'][number]
/** 声明所在的 registry 层（built-in 只出现在合并快照里）。 */
export type RegistrySource = RegistryAliasDefinition['source']
/** registry 层文件的来源（没有 built-in）。 */
export type RegistryLayerSource = RegistryLayerSnapshot['source']
/** 一层 raw 模型声明（没有 source/path/组折叠）。 */
export type RegistryModelDeclaration = RegistryLayerSnapshot['models'][number]
/** 一层 raw 别名声明（没有 source/path）。 */
export type RegistryAliasDeclaration = RegistryLayerSnapshot['aliases'][number]

/** UI 的三个空间：合并生效面、工作区层、用户层。 */
export type RegistrySpace = 'merged' | 'project' | 'user'
/** 列表的两种条目。 */
export type RegistryKind = 'alias' | 'model'

/**
 * 路线的健康投影，结构镜像 contract 的 RouteHealth。
 *
 * 现在宿主没有把失败台账接到 /state，所以构建出的行默认没有这个字段；
 * 缺省渲染为「未判定」。构建器允许调用方传入按 route 的纯数据映射，方便
 * #66 在不新增读面的前提下接线；当前页面不传。
 */
export type RegistryHealth = 'active' | 'degraded' | 'disabled'

/** 构建 registry 行时可选的运行时投影；不是新的读面。 */
export interface RegistryBuildOptions {
  /** 按 `provider/model` 路线给出的健康；缺省 = 未判定。 */
  readonly healthByRoute?: Readonly<Record<string, RegistryHealth>> | undefined
}

/** 一层 raw 声明的稳定引用（层关系里显示「由哪一层接管」）。 */
export interface LayerRef {
  readonly source: RegistrySource
  readonly path?: string | undefined
}

/** 层关系种类与对应的 UI 文案由本模块唯一决定。 */
export type LayerRelationKind = 'none' | 'shadows' | 'covers' | 'covered'

/**
 * 一行相对其它同名声明的层关系。
 *
 * - merged 行：`shadows`，label = 「遮蔽 N」；
 * - project 行：`covers`，label = 「覆盖 N」，`covered` 是低层声明；
 * - user 行：`covered`，label = 「被覆盖」，`coveredBy` 是高层赢家；
 * - 无同名冲突：`none`，label 为空串。
 *
 * `takeover` 是「删掉本行后接管的下一条声明」：project 行指向 user 行，
 * merged 行指向赢家下面的第一层；user 行没有更低层，因此没有 takeover。
 */
export interface LayerRelation {
  readonly kind: LayerRelationKind
  readonly count: number
  readonly label: string
  readonly coveredBy?: LayerRef | undefined
  readonly covered?: readonly LayerRef[] | undefined
  readonly takeover?: LayerRef | undefined
}

/** 别名池里一个 target 的求值状态（按合并快照，不重跑引擎）。 */
export type AliasPoolState = 'selected' | 'not-reached' | 'unknown-model' | 'disabled'

/**
 * 池里一个 target 的只读投影，顺序严格按声明。
 *
 * `selected` 是第一个存在且 available 的 target；之后的可用 target 是
 * `not-reached`，不存在的是 `unknown-model`，存在但 available:false 的是
 * `disabled`。health 只做可选透传，缺省没有这个字段。
 */
export interface AliasPoolEntry {
  readonly index: number
  readonly name: string
  readonly state: AliasPoolState
  /** 一句给 detail 判色的原因，不替代 state。 */
  readonly reason: string
  readonly model?: RegistryModelDefinition | undefined
  readonly route?: string | undefined
  readonly available?: boolean | undefined
  readonly health?: RegistryHealth | undefined
}

/** 一个模型经别名触达的 agent 与路径（按 agent 去重，via 合并多条别名）。 */
export interface ReachAgent {
  readonly agent: string
  readonly via: readonly string[]
}

/** 所有行共有的稳定身份与层信息。 */
export interface RegistryRowBase {
  /** 稳定 key：`kind:space:name`，含空间，切空间不会误命中。 */
  readonly key: string
  readonly kind: RegistryKind
  readonly space: RegistrySpace
  readonly name: string
  readonly source: RegistrySource
  readonly path?: string | undefined
  readonly layer: LayerRelation
  /** built-in / synthesized 条目只读；层空间行始终可写。 */
  readonly readOnly: boolean
  /** 「仅异常」的唯一谓词；列表与测试共用。 */
  readonly hasIssues: boolean
}

/**
 * 别名行。
 *
 * `declaration` 是本空间看到的声明原文；merged 行就是合并快照里的生效别名。
 * `pool` / `target` / `fanIn` 都按合并生效面求值：层空间里被覆盖的 user
 * 行也能看到当前实际会命中的 target 与关联。
 */
export interface AliasRow extends RegistryRowBase {
  readonly kind: 'alias'
  readonly declaration: RegistryAliasDeclaration
  /** 合并快照里的同名生效别名；层空间被覆盖时仍按这一面求关联。 */
  readonly effective: RegistryAliasDefinition
  /** 声明里的池，顺序即优先级。 */
  readonly targets: readonly string[]
  readonly pool: readonly AliasPoolEntry[]
  /** 第一个可用 target 的模型条目；没有可用目标时缺省。 */
  readonly target?: RegistryModelDefinition | undefined
  readonly selectedTarget?: AliasPoolEntry | undefined
  /** 本行 raw 池里选中 target 的 available；模型值来自合并快照（组折叠已完成）。 */
  readonly available?: boolean | undefined
  /** 本行 raw 池里选中 target 路线的 health；缺省 = 未判定。 */
  readonly health?: RegistryHealth | undefined
  /** `agent.modelOrder` 命中该别名的 agent，按快照顺序。 */
  readonly users: readonly string[]
  /** 同一路线的其它生效别名（按线路去重，排除 built-in 与自身）。 */
  readonly fanIn: readonly RegistryAliasDefinition[]
  /** 池里至少一个 target 不存在（或池为空）。 */
  readonly dangling: boolean
  /** 没有任何 target 被选中，且至少一个 target 因 available:false 被跳过。 */
  readonly disabled: boolean
}

/**
 * 模型条目行。
 *
 * 层空间的 `provider` / `model` / `declaredAvailable` 是 raw 声明；`available`
 * 与 `effective` 是合并生效面（同一名字的赢家），因此 user 行被 project
 * 覆盖时，声明与生效值可以不同。关联（aliases / fanIn / reach / health）也按
 * 生效面求值。`groupFolded` 只在生效行上为 true，表示声明 true 被组级开关
 * 折成 false。
 */
export interface ModelRow extends RegistryRowBase {
  readonly kind: 'model'
  readonly declaration: RegistryModelDeclaration
  readonly provider: string
  readonly model: string
  /** 本行声明的路线 `provider/model`。 */
  readonly route: string
  /** 合并快照里同名生效条目的路线。 */
  readonly effectiveRoute: string
  readonly effective: RegistryModelDefinition
  /** 生效条目的 available（装载期已折叠组开关）。 */
  readonly available: boolean
  /** 本行 raw 声明的 available；merged 行取赢家声明。 */
  readonly declaredAvailable: boolean
  /** 模型级开关的聚合键：modelGroup，缺省为自身名。 */
  readonly group: string
  readonly groupFolded: boolean
  readonly synthesized: boolean
  readonly sysPrompt?: string | undefined
  /** 指向本条目名的生效别名（含 built-in）。 */
  readonly aliases: readonly RegistryAliasDefinition[]
  /** 指向本条目路线的生效别名，按线路去重（含指向本条目的别名，排除 built-in）。 */
  readonly fanIn: readonly RegistryAliasDefinition[]
  /** 经别名触达该路线的 agent；layer 空间也按合并生效面。 */
  readonly reach: readonly ReachAgent[]
  /** 生效路线的 health；缺省 = 未判定。 */
  readonly health?: RegistryHealth | undefined
}

/** 列表的一行。 */
export type RegistryRow = AliasRow | ModelRow

/** 列表查询；与 AgentListQuery 同构，filter 先于 sort。 */
export interface RegistryListQuery {
  /** 大小写不敏感的 haystack：名称、target/路线、path、关联、层标签。 */
  readonly text?: string | undefined
  /** 只显示 hasIssues 的行。 */
  readonly onlyIssues?: boolean | undefined
  /** 排序轴；缺省 name。 */
  readonly sort?: 'name' | 'refs' | 'layer' | undefined
  /** 排序方向；缺省升序，tie-break 始终按 name / key 升序。 */
  readonly direction?: 'asc' | 'desc' | undefined
}

/** 稳定行身份；名称与空间一起决定 key。 */
export function rowKey(kind: RegistryKind, space: RegistrySpace, name: string): string {
  return `${kind}:${space}:${name}`
}

/** 层标签（展示词与原型 model.ts 一致）。 */
export function registryLayerLabel(source: RegistrySource): string {
  if (source === 'project-dsh') return 'project · .dsh'
  if (source === 'user-dsh') return 'user · ~/.dsh'
  return 'built-in'
}

/** 健康字段的展示词；缺省固定为「未判定」，不是按 available 猜测。 */
export function healthLabel(health: RegistryHealth | undefined): string {
  switch (health) {
    case 'active':
      return '正常'
    case 'degraded':
      return '降级'
    case 'disabled':
      return '已停用'
    case undefined:
      return '未判定'
  }
}

/** 路线的唯一键：provider/model。 */
export function routeKey(model: { readonly provider: string; readonly model: string }): string {
  return `${model.provider}/${model.model}`
}

/** `agent.modelOrder` 命中该别名的 agent 名，按快照顺序。 */
export function agentsUsingAlias(
  alias: string,
  agents: readonly RegistryAgentDefinition[],
): readonly string[] {
  return agents
    .filter((agent) => (agent.modelOrder ?? []).includes(alias))
    .map((agent) => agent.agentName)
}

/**
 * 重映射影响预览：只按 `modelOrder` 是否命中别名统计受影响 agent，不重跑
 * 链解析。`newTargets` 收 0 / 1 / N 个目标（#36 落地前 UI 先传单元素）；
 * 目标形状不影响受影响集合，因为改名不改注入名。
 */
export function remapImpact(
  alias: string,
  newTargets: readonly string[],
  agents: readonly RegistryAgentDefinition[],
): readonly string[] {
  // 形状是接口的一部分；受影响集合只由 agent 侧 modelOrder 决定。
  void newTargets
  return agentsUsingAlias(alias, agents)
}

/* ── 内部：声明索引与层关系 ───────────────────────────────────────── */

interface DeclaredRef {
  readonly source: RegistryLayerSource
  readonly path: string
}

interface DeclaredEntry<T> extends DeclaredRef {
  readonly declaration: T
}

interface RegistryContext {
  readonly snapshot: ControlSnapshot
  readonly modelsByName: ReadonlyMap<string, RegistryModelDefinition>
  readonly aliasesByName: ReadonlyMap<string, RegistryAliasDefinition>
  readonly healthByRoute: Readonly<Record<string, RegistryHealth>> | undefined
}

const SOURCE_RANK: Readonly<Record<RegistrySource, number>> = {
  'project-dsh': 0,
  'user-dsh': 1,
  'built-in': 2,
}

const NO_LAYER: LayerRelation = { kind: 'none', count: 0, label: '' }

function createContext(snapshot: ControlSnapshot, options: RegistryBuildOptions): RegistryContext {
  const modelsByName = new Map<string, RegistryModelDefinition>()
  for (const entry of snapshot.models) modelsByName.set(entry.modelName, entry)
  const aliasesByName = new Map<string, RegistryAliasDefinition>()
  for (const entry of snapshot.aliases) aliasesByName.set(entry.alias, entry)
  return { snapshot, modelsByName, aliasesByName, healthByRoute: options.healthByRoute }
}

/** 空间到层来源的唯一映射；merged 没有自己的层（读作 undefined）。 */
export function layerSourceOf(space: RegistrySpace): RegistryLayerSource | undefined {
  if (space === 'project') return 'project-dsh'
  if (space === 'user') return 'user-dsh'
  return undefined
}

function layerFor(
  snapshot: ControlSnapshot,
  space: Exclude<RegistrySpace, 'merged'>,
): RegistryLayerSnapshot | undefined {
  const source = layerSourceOf(space)
  return snapshot.registryLayers.find((layer) => layer.source === source)
}

function indexLayerEntries<T>(
  layers: readonly RegistryLayerSnapshot[],
  select: (layer: RegistryLayerSnapshot) => readonly T[],
  nameOf: (entry: T) => string,
): ReadonlyMap<string, readonly DeclaredEntry<T>[]> {
  const index = new Map<string, DeclaredEntry<T>[]>()
  // registryLayers 已是最高优先级在前，桶内保持同一顺序。
  for (const layer of layers) {
    for (const declaration of select(layer)) {
      const bucket = index.get(nameOf(declaration))
      const entry: DeclaredEntry<T> = { source: layer.source, path: layer.path, declaration }
      if (bucket === undefined) index.set(nameOf(declaration), [entry])
      else bucket.push(entry)
    }
  }
  return index
}

function layerRefOf(ref: DeclaredRef): LayerRef {
  return { source: ref.source, path: ref.path }
}

function makeLayerRelation(
  kind: LayerRelationKind,
  count: number,
  label: string,
  extra: {
    readonly coveredBy?: LayerRef | undefined
    readonly covered?: readonly LayerRef[] | undefined
    readonly takeover?: LayerRef | undefined
  } = {},
): LayerRelation {
  const relation: LayerRelation = { kind, count, label }
  return {
    ...relation,
    ...(extra.coveredBy === undefined ? {} : { coveredBy: extra.coveredBy }),
    ...(extra.covered === undefined ? {} : { covered: extra.covered }),
    ...(extra.takeover === undefined ? {} : { takeover: extra.takeover }),
  }
}

/** merged 行的关系只比较声明层，不重算合并。 */
function mergedRelation(refs: readonly DeclaredRef[], winnerSource: RegistrySource): LayerRelation {
  if (winnerSource === 'built-in') return NO_LAYER
  const winnerIndex = refs.findIndex((ref) => ref.source === winnerSource)
  if (winnerIndex < 0) return NO_LAYER
  const lower = refs.slice(winnerIndex + 1)
  const takeover = lower[0]
  if (takeover === undefined) return NO_LAYER
  return makeLayerRelation('shadows', lower.length, `遮蔽 ${lower.length}`, { takeover: layerRefOf(takeover) })
}

/** project 行看它覆盖的低层；user 行看它被哪一层覆盖。 */
function layerRelation(
  refs: readonly DeclaredRef[],
  space: Exclude<RegistrySpace, 'merged'>,
  source: RegistrySource,
): LayerRelation {
  const index = refs.findIndex((ref) => ref.source === source)
  if (index < 0) return NO_LAYER
  if (space === 'project') {
    const lower = refs.slice(index + 1)
    const takeover = lower[0]
    if (takeover === undefined) return NO_LAYER
    return makeLayerRelation('covers', lower.length, `覆盖 ${lower.length}`, {
      covered: lower.map(layerRefOf),
      takeover: layerRefOf(takeover),
    })
  }
  const higher = refs.slice(0, index)
  const winner = higher[0]
  if (winner === undefined) return NO_LAYER
  return makeLayerRelation('covered', higher.length, '被覆盖', { coveredBy: layerRefOf(winner) })
}

/* ── 内部：解析谓词、fan-in 与可达面 ─────────────────────────────── */

function healthOf(context: RegistryContext, route: string): RegistryHealth | undefined {
  return context.healthByRoute?.[route]
}

function aliasTouchesRoute(
  alias: RegistryAliasDefinition,
  route: string,
  modelsByName: ReadonlyMap<string, RegistryModelDefinition>,
): boolean {
  for (const target of alias.targets) {
    const model = modelsByName.get(target)
    if (model !== undefined && routeKey(model) === route) return true
  }
  return false
}

/** 同一路线的其它生效别名；built-in 不参与 fan-in（#35 口径）。 */
function fanInForRoute(
  context: RegistryContext,
  route: string,
  excludeAlias?: string,
): readonly RegistryAliasDefinition[] {
  return context.snapshot.aliases.filter(
    (alias) =>
      alias.source !== 'built-in' &&
      alias.alias !== excludeAlias &&
      aliasTouchesRoute(alias, route, context.modelsByName),
  )
}

function aliasesPointingAt(
  context: RegistryContext,
  modelName: string,
): readonly RegistryAliasDefinition[] {
  return context.snapshot.aliases.filter((alias) => alias.targets.includes(modelName))
}

function reachFor(
  context: RegistryContext,
  aliases: readonly RegistryAliasDefinition[],
): readonly ReachAgent[] {
  const names = new Set<string>()
  for (const alias of aliases) names.add(alias.alias)
  if (names.size === 0) return []
  const reach: ReachAgent[] = []
  for (const agent of context.snapshot.agents) {
    const order = agent.modelOrder ?? []
    const via = [...names].filter((name) => order.includes(name)).sort((left, right) => left.localeCompare(right, 'zh-CN'))
    if (via.length > 0) reach.push({ agent: agent.agentName, via })
  }
  return reach
}

function evaluatePool(
  context: RegistryContext,
  targets: readonly string[],
): readonly AliasPoolEntry[] {
  let selected = false
  const pool: AliasPoolEntry[] = []
  targets.forEach((name, index) => {
    const model = context.modelsByName.get(name)
    if (model === undefined) {
      pool.push({ index, name, state: 'unknown-model', reason: '目标模型条目不存在' })
      return
    }
    const route = routeKey(model)
    const health = healthOf(context, route)
    let state: AliasPoolState
    let reason: string
    if (!model.available) {
      state = 'disabled'
      reason = 'available:false · 解析时跳过'
    } else if (!selected) {
      state = 'selected'
      reason = '命中'
      selected = true
    } else {
      state = 'not-reached'
      reason = '前序目标已命中，未到达'
    }
    pool.push({ index, name, state, reason, model, route, available: model.available, health })
  })
  return pool
}

/* ── 行构造 ──────────────────────────────────────────────────────── */

function buildAliasRow(
  context: RegistryContext,
  declaration: RegistryAliasDeclaration,
  effective: RegistryAliasDefinition,
  space: RegistrySpace,
  source: RegistrySource,
  path: string | undefined,
  refs: readonly DeclaredRef[],
): AliasRow {
  const name = effective.alias
  const targets = declaration.targets
  const pool = evaluatePool(context, targets)
  const selectedTarget = pool.find((entry) => entry.state === 'selected')
  const target = selectedTarget?.model
  // 关联走合并生效面：被 project 覆盖的 user 行，fan-in 按 project 那条
  // 别名的路线求值，而不是按本行 raw targets；行本身仍显示 raw 声明。
  const effectivePool = evaluatePool(context, effective.targets)
  const effectiveSelected = effectivePool.find((entry) => entry.state === 'selected')
  const associationRoute =
    effectiveSelected?.route ?? effectivePool.find((entry) => entry.route !== undefined)?.route
  const fanIn =
    effective.source === 'built-in' || associationRoute === undefined
      ? []
      : fanInForRoute(context, associationRoute, effective.alias)
  const dangling = pool.length === 0 || pool.some((entry) => entry.state === 'unknown-model')
  const disabled = target === undefined && pool.some((entry) => entry.state === 'disabled')
  const hasIssues = dangling || pool.some((entry) => entry.state === 'disabled')
  const layer =
    space === 'merged'
      ? mergedRelation(refs, effective.source)
      : layerRelation(refs, space, source)
  return {
    key: rowKey('alias', space, name),
    kind: 'alias',
    space,
    name,
    source,
    ...(path === undefined ? {} : { path }),
    layer,
    readOnly: effective.source === 'built-in',
    hasIssues,
    declaration,
    effective,
    targets,
    pool,
    ...(target === undefined ? {} : { target }),
    ...(selectedTarget === undefined ? {} : { selectedTarget }),
    ...(target === undefined ? {} : { available: target.available }),
    ...(selectedTarget?.health === undefined ? {} : { health: selectedTarget.health }),
    users: agentsUsingAlias(name, context.snapshot.agents),
    fanIn,
    dangling,
    disabled,
  }
}

function buildModelRow(
  context: RegistryContext,
  declaration: RegistryModelDeclaration,
  effective: RegistryModelDefinition,
  space: RegistrySpace,
  source: RegistrySource,
  path: string | undefined,
  refs: readonly DeclaredEntry<RegistryModelDeclaration>[],
): ModelRow {
  const name = effective.modelName
  const effectiveRoute = routeKey(effective)
  const rawWinner = refs.find((ref) => ref.source === effective.source)
  const declaredAvailable =
    space === 'merged'
      ? (rawWinner?.declaration.available ?? effective.available)
      : declaration.available
  const effectiveRow = space === 'merged' || source === effective.source
  const aliases = aliasesPointingAt(context, name)
  const fanIn = fanInForRoute(context, effectiveRoute)
  const reach = reachFor(context, [...aliases, ...fanIn])
  const layer =
    space === 'merged'
      ? mergedRelation(refs, effective.source)
      : layerRelation(refs, space, source)
  return {
    key: rowKey('model', space, name),
    kind: 'model',
    space,
    name,
    source,
    ...(path === undefined ? {} : { path }),
    layer,
    readOnly: effective.source === 'built-in' || effective.synthesized === true,
    // 层空间里 raw 停用不会被覆盖隐藏；merged 行同时看生效面，组折叠可见。
    hasIssues: !declaredAvailable || !effective.available,
    declaration,
    provider: declaration.provider,
    model: declaration.model,
    route: routeKey(declaration),
    effectiveRoute,
    effective,
    available: effective.available,
    declaredAvailable,
    group: declaration.modelGroup ?? declaration.modelName,
    groupFolded: effectiveRow && declaredAvailable && !effective.available,
    synthesized: effective.synthesized === true,
    ...(declaration.sysPrompt === undefined ? {} : { sysPrompt: declaration.sysPrompt }),
    aliases,
    fanIn,
    reach,
    ...(healthOf(context, effectiveRoute) === undefined ? {} : { health: healthOf(context, effectiveRoute) }),
  }
}

/** 合并空间的行来自宿主已合并的快照（含 built-in / synthesized）。 */
export function buildAliasRows(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  options: RegistryBuildOptions = {},
): readonly AliasRow[] {
  const context = createContext(snapshot, options)
  const refsByName = indexLayerEntries(
    snapshot.registryLayers,
    (layer) => layer.aliases,
    (declaration) => declaration.alias,
  )
  if (space === 'merged') {
    return snapshot.aliases.map((effective) =>
      buildAliasRow(context, effective, effective, 'merged', effective.source, effective.path, refsByName.get(effective.alias) ?? []),
    )
  }
  const layer = layerFor(snapshot, space)
  if (layer === undefined) return []
  const rows: AliasRow[] = []
  for (const declaration of layer.aliases) {
    const effective = context.aliasesByName.get(declaration.alias)
    const refs = refsByName.get(declaration.alias)
    if (effective === undefined || refs === undefined) continue
    rows.push(buildAliasRow(context, declaration, effective, space, layer.source, layer.path, refs))
  }
  return rows
}

/** 层空间的行来自 registryLayers 的 raw 声明；合并值只用于生效面。 */
export function buildModelRows(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  options: RegistryBuildOptions = {},
): readonly ModelRow[] {
  const context = createContext(snapshot, options)
  const refsByName = indexLayerEntries(
    snapshot.registryLayers,
    (layer) => layer.models,
    (declaration) => declaration.modelName,
  )
  if (space === 'merged') {
    return snapshot.models.map((effective) =>
      buildModelRow(context, effective, effective, 'merged', effective.source, effective.path, refsByName.get(effective.modelName) ?? []),
    )
  }
  const layer = layerFor(snapshot, space)
  if (layer === undefined) return []
  const rows: ModelRow[] = []
  for (const declaration of layer.models) {
    const effective = context.modelsByName.get(declaration.modelName)
    const refs = refsByName.get(declaration.modelName)
    if (effective === undefined || refs === undefined) continue
    rows.push(buildModelRow(context, declaration, effective, space, layer.source, layer.path, refs))
  }
  return rows
}

/** 按空间与类别构建行；两个页签共用同一实现。 */
export function buildRegistryRows(
  snapshot: ControlSnapshot,
  space: RegistrySpace,
  kind: RegistryKind,
  options: RegistryBuildOptions = {},
): readonly RegistryRow[] {
  return kind === 'alias' ? buildAliasRows(snapshot, space, options) : buildModelRows(snapshot, space, options)
}

/* ── 列表查询求值器 ──────────────────────────────────────────────── */

function refCount(row: RegistryRow): number {
  return row.kind === 'alias' ? row.users.length : row.aliases.length
}

function haystack(row: RegistryRow): string {
  if (row.kind === 'alias') {
    return [
      row.name,
      row.declaration.targets.join(' '),
      row.target === undefined ? '' : `${row.target.provider}/${row.target.model} ${row.target.modelName}`,
      row.path ?? '',
      row.users.join(' '),
      registryLayerLabel(row.source),
      ...row.fanIn.map((alias) => alias.alias),
    ]
      .join('\n')
      .toLowerCase()
  }
  return [
    row.name,
    `${row.provider}/${row.model}`,
    `${row.effective.provider}/${row.effective.model}`,
    row.path ?? '',
    ...row.aliases.map((alias) => alias.alias),
    ...row.fanIn.map((alias) => alias.alias),
    ...row.reach.map((reached) => `${reached.agent} ${reached.via.join(' ')}`),
    registryLayerLabel(row.source),
  ]
    .join('\n')
    .toLowerCase()
}

function compareRows(sort: NonNullable<RegistryListQuery['sort']>, left: RegistryRow, right: RegistryRow): number {
  switch (sort) {
    case 'name':
      return left.name.localeCompare(right.name, 'zh-CN')
    case 'refs':
      return refCount(left) - refCount(right)
    case 'layer':
      return SOURCE_RANK[left.source] - SOURCE_RANK[right.source]
  }
}

/**
 * 列表唯一的查询求值器：先过滤再排序；排序稳定（同轴 tie 按 name / key
 * 升序），不修改输入行。列表与测试共用这一份，不在组件里内联重写。
 */
export function evaluateRegistryQuery(
  rows: readonly RegistryRow[],
  query: RegistryListQuery,
): readonly RegistryRow[] {
  let result: readonly RegistryRow[] = rows
  const text = query.text?.trim().toLowerCase() ?? ''
  if (text !== '') result = result.filter((row) => haystack(row).includes(text))
  if (query.onlyIssues === true) result = result.filter((row) => row.hasIssues)
  const direction = query.direction === 'desc' ? -1 : 1
  const sort = query.sort ?? 'name'
  return [...result].sort((left, right) => {
    const byAxis = compareRows(sort, left, right) * direction
    if (byAxis !== 0) return byAxis
    const byName = left.name.localeCompare(right.name, 'zh-CN')
    if (byName !== 0) return byName
    return left.key.localeCompare(right.key, 'zh-CN')
  })
}
