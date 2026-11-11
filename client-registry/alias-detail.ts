/**
 * 别名详情（票 64）：池状态、解析链诊断、fan-in / 使用者与重映射影响预览的
 * 纯投影。无 React、无 IO；链诊断只消费 A2 的按需读面（POST /agent-atelier/chain）
 * 返回的 AgentChainReport，UI 不重跑解析引擎。
 *
 * 链报告是「某个 agent 的一次解析」：本别名在这条链里的候选由
 * aliasChain 的 orderIndex 与 candidates 对齐。池里每条 target 的健康只按
 * 路线匹配候选；匹配不到读作「未判定」，不按 available 猜测。
 */
import type { AgentChainReport, ControlSnapshot } from '../src/control/index.ts'
import type {
  AliasPoolEntry,
  AliasPoolState,
  AliasRow,
  RegistryHealth,
} from './registry-model.ts'
import { healthLabel, remapImpact, routeKey } from './registry-model.ts'

/** 链报告（票 58 的 AgentChainReport 投影），不 import contract 深路径。 */
export type AliasChainReport = AgentChainReport['report']
export type AliasChainStep = AliasChainReport['aliasChain'][number]
export type AliasChainCandidate = AliasChainReport['candidates'][number]
/** 候选未命中的原因（含链停在前序目标上的 not-reached）。 */
export type AliasChainSkip = NonNullable<AliasChainCandidate['skipped']>

/** 页面持有的按需读面状态；alias 用来丢弃切换选中后到达的旧报告。 */
export type AliasChainState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly alias: string; readonly agent: string }
  | {
      readonly status: 'ready'
      readonly alias: string
      readonly agent: string
      readonly report: AliasChainReport
      readonly exhausted: boolean
    }
  | { readonly status: 'error'; readonly alias: string; readonly agent: string; readonly message: string }

/** 复制名称的一次性反馈。 */
export type AliasCopyStatus = 'idle' | 'copied' | 'failed'

/** 选中切换后仍拿到旧报告时按未读取处理（effect 下一帧会换掉它）。 */
export function chainForAlias(chain: AliasChainState, alias: string): AliasChainState {
  if (chain.status === 'idle' || chain.alias === alias) return chain
  return { status: 'idle' }
}

/** 本别名在这次解析里的那条 alias 步骤；不在 modelOrder 里则没有。 */
export function aliasStepOf(report: AliasChainReport, alias: string): AliasChainStep | undefined {
  return report.aliasChain.find((step) => step.alias === alias)
}

/** 本别名按目标声明顺序展开出的候选；报告里 alias half 在前，顺序可依赖。 */
export function aliasCandidatesOf(
  report: AliasChainReport,
  alias: string,
): readonly AliasChainCandidate[] {
  const step = aliasStepOf(report, alias)
  if (step === undefined) return []
  return report.candidates.filter(
    (candidate) => candidate.origin === 'alias' && candidate.orderIndex === step.orderIndex,
  )
}

/** 候选的路线文案；未知 target 的候选没有路线。 */
export function candidateRouteLabel(candidate: AliasChainCandidate): string {
  return candidate.route === undefined
    ? '（目标模型条目缺失）'
    : routeKey(candidate.route)
}

/** 池条目按路线对齐候选；缺路线的条目（悬空目标）不硬猜是哪一条候选。 */
export function candidateForPool(
  entry: AliasPoolEntry,
  candidates: readonly AliasChainCandidate[],
): AliasChainCandidate | undefined {
  if (entry.route === undefined) return undefined
  return candidates.find(
    (candidate) => candidate.route !== undefined && routeKey(candidate.route) === entry.route,
  )
}

/** 池条目的健康：候选优先，其次构建器透传，最后缺省未判定。 */
export function poolHealthOf(
  entry: AliasPoolEntry,
  candidates: readonly AliasChainCandidate[],
): RegistryHealth | undefined {
  return candidateForPool(entry, candidates)?.health ?? entry.health
}

/** 池状态词（存在 / available / 命中位置）。 */
export function poolStateLabel(state: AliasPoolState): string {
  switch (state) {
    case 'selected':
      return '命中'
    case 'not-reached':
      return '未到达'
    case 'unknown-model':
      return '不存在'
    case 'disabled':
      return '停用'
  }
}

/** 池状态分色：命中 ok、未到达灰、不存在 err、停用 warn。 */
export function poolStateTagClass(
  state: AliasPoolState,
): 'tag-ok' | 'tag-warn' | 'tag-err' | 'tag-dim' {
  switch (state) {
    case 'selected':
      return 'tag-ok'
    case 'not-reached':
      return 'tag-dim'
    case 'unknown-model':
      return 'tag-err'
    case 'disabled':
      return 'tag-warn'
  }
}

/** 健康分色：未判定灰（不是按 available 猜），正常 ok，降级 warn，已停用 err。 */
export function healthTagClass(
  health: RegistryHealth | undefined,
): 'tag-ok' | 'tag-warn' | 'tag-err' | 'tag-dim' {
  switch (health) {
    case 'active':
      return 'tag-ok'
    case 'degraded':
      return 'tag-warn'
    case 'disabled':
      return 'tag-err'
    case undefined:
      return 'tag-dim'
  }
}

export function poolHealthLabel(
  entry: AliasPoolEntry,
  candidates: readonly AliasChainCandidate[],
): string {
  return healthLabel(poolHealthOf(entry, candidates))
}

/** 候选未命中的一句话原因。 */
export function chainSkipLabel(skip: AliasChainSkip): string {
  switch (skip) {
    case 'not-reached':
      return '前序目标已命中，未到达'
    case 'unknown-alias':
      return '别名不存在'
    case 'unknown-model':
      return '目标模型条目不存在'
    case 'unavailable':
      return 'available:false，解析时跳过'
    case 'not-allowed':
      return '不在允许的路线内'
    case 'unsupported-effort':
      return '不支持该 reasoning effort'
  }
}

/** 候选结论：命中或未命中的原因。 */
export function candidateSkipText(candidate: AliasChainCandidate): string {
  return candidate.skipped === undefined ? '本次命中' : chainSkipLabel(candidate.skipped)
}

/** 命中这条别名的候选（无 skipped 且有路线）。 */
export function aliasWinnerCandidate(
  report: AliasChainReport,
  alias: string,
): AliasChainCandidate | undefined {
  return aliasCandidatesOf(report, alias).find(
    (candidate) => candidate.skipped === undefined && candidate.route !== undefined,
  )
}

export interface ChainVerdict {
  readonly text: string
  readonly tone: 'ok' | 'warn' | 'err'
}

/**
 * 链对这条别名的结论：命中（路线） / 未命中（后续别名或原始 model 命中） /
 * 链耗尽（会话启动会失败）。文案只消费报告，不重算。
 */
export function chainVerdictOf(
  report: AliasChainReport,
  alias: string,
  exhausted: boolean,
): ChainVerdict {
  const step = aliasStepOf(report, alias)
  if (step === undefined) return { text: '该 agent 的 modelOrder 未包含这个别名', tone: 'err' }
  if (step.skipped === 'unknown-alias') return { text: '别名不在 registry 快照里', tone: 'err' }
  const winner = aliasWinnerCandidate(report, alias)
  if (winner !== undefined) {
    const name = winner.modelName === undefined ? '' : winner.modelName + ' '
    return { text: '命中 ' + name + '· ' + candidateRouteLabel(winner), tone: 'ok' }
  }
  if (exhausted) return { text: '链耗尽：本别名的目标都没有命中', tone: 'err' }
  if (report.selectedBy === 'raw') return { text: '别名未命中：链回退到原始 model 链', tone: 'warn' }
  if (report.selectedBy === 'alias') return { text: '别名未命中：后续别名先命中', tone: 'warn' }
  return { text: '别名未命中', tone: 'warn' }
}

/** 生效 reasoning effort 的来源词。 */
export function effortSourceLabel(source: AliasChainReport['effortSource']): string {
  switch (source) {
    case 'chain':
      return '目标条目'
    case 'agent':
      return 'agent 默认'
    case 'none':
      return '未设置'
  }
}

/* ── 重映射影响预览（只读现有快照） ─────────────────────────────── */

export interface RemapOption {
  readonly name: string
  readonly route: string
  readonly current: boolean
}

/** 可选的新目标：合并快照里 available 的模型条目，当前目标排第一。 */
export function remapOptionsOf(
  snapshot: ControlSnapshot,
  row: AliasRow,
): readonly RemapOption[] {
  const currentName = row.selectedTarget?.name
  return snapshot.models
    .filter((entry) => entry.available)
    .map((entry) => ({
      name: entry.modelName,
      route: routeKey(entry),
      current: entry.modelName === currentName,
    }))
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN')
    })
}

/** 当前预览的目标：请求值命中选项就用它，否则落回当前目标，再否则第一个。 */
export function activeRemapOption(
  options: readonly RemapOption[],
  requested: string | null,
): RemapOption | undefined {
  if (requested !== null) {
    const hit = options.find((option) => option.name === requested)
    if (hit !== undefined) return hit
  }
  return options.find((option) => option.current) ?? options[0]
}

export interface RemapPreview {
  readonly target: RemapOption
  readonly current: boolean
  /** 改到该目标后受影响的 agent；走 #61 的 remapImpact，不重跑链解析。 */
  readonly affected: readonly string[]
}

/** 目标不在可选集合里（被停用 / 已删除）时没有预览。 */
export function remapPreviewOf(
  snapshot: ControlSnapshot,
  row: AliasRow,
  targetName: string,
): RemapPreview | undefined {
  const target = remapOptionsOf(snapshot, row).find((option) => option.name === targetName)
  if (target === undefined) return undefined
  return {
    target,
    current: target.current,
    affected: remapImpact(row.name, [target.name], snapshot.agents),
  }
}
