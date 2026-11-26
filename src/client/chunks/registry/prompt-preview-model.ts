/**
 * 系统提示词预览的纯投影（票 85）。
 *
 * 数据纪律（规格 #82 §4 不变量、brief §1.7）：
 * - 本模块**只读**宿主读面已经投影好的 `PromptSegmentsView`：不重跑装配、不重跑层
 *   合并、不调 `buildPromptSegments`（那段代码在 `src/assembly/`，chunk 按 import
 *   矩阵 `CHUNK_ENTRIES` 根本读不到）。这里只做「视图怎么摆」。
 * - 分段视图的 7 组顺序由投影方（I2）保证；本模块不重排、不补造空组，只贴标签。
 * - 认不出的一律如实呈现：`shadowedBy.visibility === 'opaque'` 只写「遮蔽关系不可见」，
 *   不编遮蔽者（ADR-0009 后果第 2 条）。
 *
 * 新鲜度条的口径是 Captain 裁决（brief §8 #11 / #12），覆盖票面 #85 第 3 条：
 * 本仓**没有**文件 mtime 数据源（`ControlSnapshot` 无 scanId、`AgentFileSystem` 端口
 * 无 mtime、宿主 `FsInfo.version` 是不透明 token 且被 `createHostFileSystem` 丢弃），
 * 所以顶部条只给「装配时刻 + 本次请求序号 + 装配所用 agent / 扫描起点」，并**显式**
 * 写「文件 mtime 不可用」。scanId 是**每请求自增的序号**，不是数据代次——文案里不
 * 出现「数据代次」「加载代次」。预览**不自动重载**。
 *
 * 无 React、无 IO、无计时器：视图层只消费这里的行与词表。
 */
import { errorMessage, isAbortError } from '../../../control/index.ts'
import { chainSkipLabel } from './alias-detail.ts'

import type {
  PromptPart,
  PromptPreviewView,
  PromptPreviewDegradation,
  PromptPreviewTier,
  PromptSegmentBase,
  PromptSegmentDiagnostic,
  PromptSegmentParts,
  PromptSegmentsView,
  PromptSourceId,
  UnattributedPromptSegment,
} from '../../../dsh/client/chunk-contracts.ts'

/* ── 一级来源词表（规格 §2 的 7 条，按注册者角色） ─────────────────── */

export interface PreviewSourceLabel {
  /** 圈号：①②③④⑤⑥⑦（规格里的编号，便于对照）。 */
  readonly ordinal: string
  /** 来源名（英文名照规格，中文一句话说明注册者）。 */
  readonly title: string
  /** 注册者一句话。 */
  readonly registrant: string
}

/** 7 条来源的固定词表。键是契约层的封闭联合，缺一条编译期就报错。 */
export const PREVIEW_SOURCE_LABELS: Readonly<Record<PromptSourceId, PreviewSourceLabel>> = {
  'harness-identity': { ordinal: '①', title: 'harness identity', registrant: '宿主 SystemPrompt 构造函数内联注册' },
  'deployment-persona': { ordinal: '②', title: '部署 persona', registrant: 'system-prompt 行 config 的 persona 前后缀' },
  'preset-persona': { ordinal: '③', title: 'preset persona', registrant: 'preset scope 注册的同名段（遮蔽部署那份）' },
  'atelier-section': { ordinal: '④', title: 'atelier 装配行', registrant: '本仓 sink 注册的节（atelier: 前缀）' },
  'tool-guidance': { ordinal: '⑤', title: '工具说明节', registrant: '工具插件与 executor 注册的说明（tools: 前缀）' },
  'runtime-context': { ordinal: '⑥', title: '运行时 context', registrant: '各插件 systemPrompt.context()' },
  'tool-declaration': { ordinal: '⑦', title: '工具声明', registrant: 'ToolsService 唯一 provider 的工具 schema' },
}

/** 一级来源的标题（含圈号），用于组标题。 */
export function previewSourceHeading(source: PromptSourceId): string {
  const label = PREVIEW_SOURCE_LABELS[source]
  return label.ordinal + ' ' + label.title
}

/* ── 段与组的行 ─────────────────────────────────────────────────── */

/** 标注分色，与既有 tag 族同名（tag-ok / tag-warn / tag-err / tag-dim）。 */
export type PreviewTagTone = 'ok' | 'warn' | 'err' | 'dim'

export interface PreviewTag {
  readonly text: string
  readonly tone: PreviewTagTone
}

/** 段内块视图：多块才可展开；单块 / 空表整段渲染（内容不丢）。 */
export function previewPartsOf(segment: PromptSegmentBase): PromptSegmentParts {
  // 与 src/assembly/segments.ts 的 promptSegmentParts 同一条判定；两份实现由
  // test/prompt-preview-ui/segments.test.ts 用真函数逐例对拍，不靠注释同步。
  const parts = segment.parts ?? []
  if (parts.length > 1) return { expandable: true, parts }
  return { expandable: false, parts: [{ name: segment.name, text: segment.text }] }
}

/**
 * 遮蔽标注文案。
 *
 * `opaque` 必须如实说「不可见」——兼容模式下宿主节的遮蔽关系没有审计面，
 * 猜一个遮蔽者就是撒谎（ADR-0009 后果第 2 条）。
 */
export function previewShadowText(shadow: NonNullable<PromptSegmentBase['shadowedBy']>): string {
  return shadow.visibility === 'visible' ? '遮蔽了同名注册（' + shadow.displaced + '）' : '遮蔽关系不可见'
}

/** 一段上的全部标注（只写宿主产物 / 账本真的给了的，缺席不等于「没有」）。 */
export function previewSegmentTags(segment: PromptSegmentBase): readonly PreviewTag[] {
  const tags: PreviewTag[] = []
  if (segment.rewrittenByWaterfall === true) tags.push({ text: '已被 waterfall 改写', tone: 'warn' })
  if (segment.shadowedBy !== undefined) tags.push({ text: previewShadowText(segment.shadowedBy), tone: 'warn' })
  if (segment.layer !== undefined) tags.push({ text: '来自 ' + segment.layer, tone: 'dim' })
  // 二级键是宿主装配名；规划名不同只作别名标注（诊断另有 alias-mismatch 一条）。
  if (segment.planName !== undefined && segment.planName !== segment.name) {
    tags.push({ text: '规划名 ' + segment.planName, tone: 'dim' })
  }
  if (segment.surface === 'context') tags.push({ text: '运行时 context', tone: 'dim' })
  if (segment.surface === 'tool') tags.push({ text: '工具声明', tone: 'dim' })
  return tags
}

export interface PreviewSegmentRow {
  /** React key；同一组内宿主装配名唯一。 */
  readonly key: string
  /** 二级键 = 宿主装配名。 */
  readonly name: string
  readonly text: string
  readonly tags: readonly PreviewTag[]
  /** 段内块视图（多块才可展开）。 */
  readonly parts: PromptSegmentParts
}

/** 一段的行；`groupKey` 只参与 React key，不进可见文案。 */
export function previewSegmentRowOf(segment: PromptSegmentBase, groupKey: string): PreviewSegmentRow {
  return {
    key: groupKey + '\u0000' + segment.name,
    name: segment.name,
    text: segment.text,
    tags: previewSegmentTags(segment),
    parts: previewPartsOf(segment),
  }
}

export interface PreviewSourceRow {
  readonly source: PromptSourceId
  readonly heading: string
  readonly registrant: string
  readonly segments: readonly PreviewSegmentRow[]
  readonly empty: boolean
}

/** 一组分段行；`view.sources` 已按固定顺序给齐（投影方的责任，这里不重排）。 */
export function buildPreviewSourceRows(view: PromptSegmentsView): readonly PreviewSourceRow[] {
  return view.sources.map((group) => {
    const label = PREVIEW_SOURCE_LABELS[group.source]
    return {
      source: group.source,
      heading: previewSourceHeading(group.source),
      registrant: label.registrant,
      segments: group.segments.map((segment) => previewSegmentRowOf(segment, group.source)),
      empty: group.segments.length === 0,
    }
  })
}

/** 认不出一级来源的段：单独一组，不塞进任何来源（不猜）。 */
export function buildUnattributedRows(
  view: PromptSegmentsView,
): readonly (PreviewSegmentRow & { readonly key: string })[] {
  return view.unattributed.map((segment: UnattributedPromptSegment) => previewSegmentRowOf(segment, 'unattributed'))
}

/* ── 折叠状态（受控；缺省展开） ───────────────────────────────────── */

/** 组折叠表：键为一级来源，值 true = 折叠。缺席读作展开。 */
export type PreviewCollapsed = Readonly<Partial<Record<PromptSourceId, boolean>>>

export function isPreviewCollapsed(collapsed: PreviewCollapsed, source: PromptSourceId): boolean {
  return collapsed[source] === true
}

/** 折叠 / 展开一组：展开即删键（不保留 false 噪音）。 */
export function toggledPreviewGroup(collapsed: PreviewCollapsed, source: PromptSourceId): PreviewCollapsed {
  if (isPreviewCollapsed(collapsed, source)) {
    const next = { ...collapsed }
    delete next[source]
    return next
  }
  return { ...collapsed, [source]: true }
}

/* ── 四档降级（规格 §5 / brief §1.7） ─────────────────────────────── */

/** 界面口径的档位：① 完整（没有 degraded 字段）+ 契约层的三档。 */
export type PreviewTier = 'full' | PromptPreviewTier

/** 档位词：① 是「没有 degraded」，不是第四个字符串（契约层同口径）。 */
export const PREVIEW_TIER_LABEL: Readonly<Record<PreviewTier, string>> = {
  full: '完整装配',
  'chain-exhausted': '链耗尽',
  static: '静态回退',
  empty: '空态',
}

/** ③ 的固定说法：降级时必须一眼看出这不是宿主装配结果。 */
export const PREVIEW_STATIC_NOTICE = '非宿主装配结果'

export function previewTierOf(degraded: PromptPreviewDegradation | undefined): PreviewTier {
  return degraded === undefined ? 'full' : degraded.tier
}

/** 档位横幅：一句话说清「这一档意味着什么」。 */
export function previewTierBanner(tier: PreviewTier): string {
  switch (tier) {
    case 'full':
      return '本次预览读的是宿主真实装配产物：分段、运行时 context 与工具声明都来自这一次 assemble()。'
    case 'chain-exhausted':
      return '链耗尽：模型链没有选中任何路由，装配没有发生。下面是引擎的解析报告，不是提示词。'
    case 'static':
      return PREVIEW_STATIC_NOTICE + '：宿主装配面不可用，本次没有跑 assemble()、没有 waterfall，也没有工具声明。'
    case 'empty':
      return '空态：连 agent 文档与模型链都取不到，没有可预览的对象。'
  }
}

/** 缺口的逐项文案（③ 的 missing 是「缺什么、为什么」的清单）。 */
export function previewMissingLines(degraded: PromptPreviewDegradation | undefined): readonly string[] {
  if (degraded === undefined) return []
  return degraded.missing.map((item) => item.item + '：' + item.reason)
}

/**
 * ② 的链解析报告：把每个候选与它的未命中原因摊开。
 *
 * 报告是引擎原样输出，这里只做「路线 · 原因」的排版，不重算解析、不判断谁该赢。
 */
export function previewChainSkipLines(degraded: PromptPreviewDegradation | undefined): readonly string[] {
  const report = degraded?.report
  if (report === undefined) return []
  const lines = report.candidates.map((candidate) => {
    const route = candidate.route === undefined
      ? '（目标模型条目缺失）'
      : candidate.route.provider + '/' + candidate.route.model
    const reason = candidate.skipped === undefined ? '本次命中' : chainSkipLabel(candidate.skipped)
    return route + ' · ' + reason
  })
  const head = '候选 ' + String(report.candidates.length) + ' 个 · 命中来源：' +
    (report.selectedBy === 'alias' ? '别名链' : report.selectedBy === 'raw' ? '原始 model 链' : '无（链耗尽）')
  return [head, ...lines]
}

/* ── 请求状态机（chunk 入口持有；受控视图只消费） ─────────────────── */

/** 一次预览请求的状态机。 */
export type PreviewRequestState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly agent: string }
  | { readonly status: 'ready'; readonly agent: string; readonly view: PromptPreviewView }
  | { readonly status: 'error'; readonly agent: string; readonly message: string }

/** 面板全部状态：选中 agent、请求状态、折叠表。 */
export interface PromptPreviewPanelState {
  /** 选中的 agent 名；null = 还没选（有 agent 时页面默认选第一个）。 */
  readonly agent: string | null
  readonly request: PreviewRequestState
  readonly collapsed: PreviewCollapsed
}

export const INITIAL_PREVIEW_PANEL_STATE: PromptPreviewPanelState = {
  agent: null,
  request: { status: 'idle' },
  collapsed: {},
}

/** 可预览的 agent 名：快照里的 agent，按名字排序（稳定，不随发现顺序漂）。 */
export function previewAgentNames(agents: readonly { readonly agentName: string }[]): readonly string[] {
  return agents.map((agent) => agent.agentName).sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

/** 选中 agent：换人即把请求状态退回 idle（旧回答不属于新 agent）。 */
export function previewStateWithAgent(
  state: PromptPreviewPanelState,
  agent: string,
): PromptPreviewPanelState {
  return { ...state, agent, request: { status: 'idle' } }
}

/** 发请求：只有选中 agent 且读面已接入才动状态。 */
export function previewStateLoading(
  state: PromptPreviewPanelState,
  wired: boolean,
): PromptPreviewPanelState {
  if (!wired || state.agent === null) return state
  return { ...state, request: { status: 'loading', agent: state.agent } }
}

/**
 * 请求落点：成功进 ready，abort 不动状态（旧状态原样保留），其余进 error。
 *
 * 到达时 agent 已被换掉就丢弃（陈旧回答不覆盖新 agent 的面板）。
 */
export function previewStateSettled(
  state: PromptPreviewPanelState,
  agent: string,
  result:
    | { readonly ok: true; readonly view: PromptPreviewView }
    | { readonly ok: false; readonly error: unknown },
): PromptPreviewPanelState {
  if (state.agent !== agent) return state
  if (result.ok) return { ...state, request: { status: 'ready', agent, view: result.view } }
  if (isAbortError(result.error)) return { ...state, request: { status: 'idle' } }
  return { ...state, request: { status: 'error', agent, message: errorMessage(result.error) } }
}

/* ── 顶部新鲜度条（Captain 裁决口径） ─────────────────────────────── */

export interface PreviewFreshnessLine {
  readonly label: string
  readonly value: string
  /** 补充说明（可选）；mtime 那一行靠它把「不可用」说清楚。 */
  readonly note?: string | undefined
}

/** 「文件 mtime 不可用」的完整说法：不判断「文件是否已改」，也不假装文档是新的。 */
export const PREVIEW_MTIME_NOTE =
  '本仓没有文档 mtime 的数据源（快照不带 scanId、文件端口不读 mtime），因此不判断「文件是否已改」，也不假装文档是新的。'

/** 「不自动重载」：预览是一次快照，文件改动后要用户自己再读一次。 */
export const PREVIEW_NO_AUTORELOAD_NOTE = '预览不会自动重载：文件改动后请重新读取一次。'

/** 新鲜度条的行（顺序固定；不出现「数据代次」「加载代次」这类词）。 */
export function previewFreshnessLines(view: {
  readonly agentName: string
  readonly cwd: string | null
  readonly assembledAt: string
  readonly scanId: number
}): readonly PreviewFreshnessLine[] {
  return [
    { label: '装配时刻', value: view.assembledAt },
    {
      label: '本次请求序号',
      value: String(view.scanId),
      note: '读面每请求自增的序号，不是数据代次：它只用来丢弃过期回答。',
    },
    { label: '装配所用 agent', value: view.agentName },
    { label: '扫描起点', value: view.cwd === null ? '用户全局（无项目根）' : view.cwd },
    { label: '文件 mtime', value: '不可用', note: PREVIEW_MTIME_NOTE },
  ]
}

/** 副作用提示：读面自己声明的那些行（每次回答都带），UI 原样展示。 */
export function previewSideEffectLines(sideEffects: readonly string[]): readonly string[] {
  return sideEffects
}

/** 预览页常驻的副作用声明：即使还没请求，也要先告诉用户这次点击会真的跑装配。 */
export const PREVIEW_SIDE_EFFECT_HEADLINE = '预览会真实执行装配链'

/** 诊断信号（alias-mismatch / missing-from-assembly）：不是错误，逐条列出。 */
export function previewDiagnosticLines(
  diagnostics: readonly PromptSegmentDiagnostic[],
): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code + ' · ' + diagnostic.name + '：' + diagnostic.message)
}

/** 视图里的段总数（标题计数用）。 */
export function previewSegmentCount(view: PromptSegmentsView): number {
  const grouped = view.sources.reduce((sum, group) => sum + group.segments.length, 0)
  return grouped + view.unattributed.length
}

/** 一段的块数（「N 块」标注用）。 */
export function previewPartCount(parts: readonly PromptPart[]): number {
  return parts.length
}
