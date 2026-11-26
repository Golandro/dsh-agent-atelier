/**
 * 票 84：把「宿主装配产物 + 注册侧账本」折成按一级来源分组的段视图。
 *
 * 数据纪律（与 `prompt-model.ts` 同构）：
 * - **纯函数**：无 React、无 IO、不读宿主注册表，也不读 `systemPrompt` 的私有层。
 *   输入已经是宿主 `assemble()` 的产物，本模块不重跑装配、不重跑层合并。
 * - **不事后归因**：贡献者身份只能来自注册侧账本（ADR-0009）。产物里没有贡献者
 *   字段，所以归不了因的段进 {@link PromptSegmentsView.unattributed}，不猜。
 * - **输出自足**：视图只含可 JSON 序列化的普通数据，不挂方法、不引用别的层类型，
 *   以便下游（UI chunk）经任意序列化边界消费。
 * - **排序稳定**：同一份输入两次求值逐字段相同；组序固定为
 *   {@link PROMPT_SOURCE_ORDER}，组内按宿主装配名的 code unit 升序（与宿主
 *   registry 的同序兜底规则一致），诊断按 (code, name) 升序。
 *
 * 二级键是**宿主装配名**（`AssembledSection.name` / context 名 / 工具名）；本仓
 * 规划名作别名标注，两者不一致时记一条 `alias-mismatch` 诊断（以宿主名为准）。
 *
 * 视图 DTO（来源、段、组、诊断、段内块视图）落在契约层
 * `src/contract/prompt-preview.ts`：它们的消费方横跨宿主读面与浏览器 chunk，
 * 而 chunk 只准读 contract 与 control，读不到 `src/assembly/`——形状放这里就够不着
 * 自己的消费者。本模块只保留宿主结构的**镜像**与投影函数。
 */
import { PROMPT_SOURCE_ORDER } from '../contract/index.ts'
import type {
  PromptPart,
  PromptSegment,
  PromptSegmentBase,
  PromptSegmentDiagnostic,
  PromptSegmentParts,
  PromptSegmentSurface,
  PromptSegmentsView,
  PromptShadow,
  PromptSourceId,
  UnattributedPromptSegment,
} from '../contract/index.ts'

/**
 * 固定组序：契约层拥有唯一一份（`src/contract/prompt-preview.ts`）。
 *
 * 顺序是视图契约的一部分（「组按固定顺序给齐、空组也保留」），消费方横跨宿主
 * 与浏览器 chunk，所以不能留在这里——chunk 读不到装配层。本模块只 re-export
 * 给既有读者，不保留第二份定义。
 */
export { PROMPT_SOURCE_ORDER } from '../contract/index.ts'

/** 宿主 `AssembledSection` 的结构镜像：装配产物里的一节（已解析文本，未插值）。 */
export interface AssembledSection {
  readonly name: string
  readonly text: string
  readonly interpolate?: boolean | undefined
}

/** 宿主 `AssembledContext` 的结构镜像：一条运行时 context。 */
export interface AssembledContext {
  readonly name: string
  readonly text: string
  readonly interpolate?: boolean | undefined
}

/** 宿主 `ToolSchema` 的结构镜像：一条工具声明。 */
export interface ToolDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

/**
 * 宿主 `PromptAssembly` 的结构镜像（规格 §4 的产物形状）。
 *
 * 只收本模块要读的四个通道；不 import 宿主包，结构上可被宿主真实产物直接赋值。
 *
 * 名字带 `Host` 前缀是刻意的：这是宿主形状的**镜像**，不是契约。契约层的
 * `PromptAssembly`（若宿主读面需要命名它）由 `src/contract/` 拥有，两者同名但
 * 不同义会让读者以为可以互相替换（AGENTS.md「Interfaces live in source」）。
 */
export interface HostPromptAssembly {
  readonly sections: readonly AssembledSection[]
  readonly contexts: readonly AssembledContext[]
  readonly variables: Readonly<Record<string, string | undefined>>
  readonly tools: readonly ToolDeclaration[]
}

/**
 * 注册侧账本的一条记录：注册方自己记「我注册了哪些节、每节有哪些子块」。
 *
 * 只由注册方填，**不从产物反推**。缺席的字段表示「注册方没记」，不是「没有」。
 */
export interface PromptSectionLedgerEntry {
  /** 二级键：宿主装配名（与产物里的 `name` 对齐）。 */
  readonly sectionName: string
  /** 本仓规划名；与 {@link sectionName} 不同即为别名不一致。 */
  readonly planName?: string | undefined
  /** 注册方声明的来源；只用于消解产物无法区分的同名节（② / ③）。 */
  readonly source?: PromptSourceId | undefined
  /** 这段文本来自哪个配置文件（若有）。 */
  readonly layer?: string | undefined
  /** 注册方观测到 waterfall 改写了自己注册的文本。 */
  readonly rewrittenByWaterfall?: boolean | undefined
  /** 这段被同名节遮蔽；只有自带账本的注册方知道。 */
  readonly shadowedBy?: PromptShadow | undefined
  /**
   * 段内块。纯数据入参：由调用方决定喂什么——本模块不假设任何宿主节可拆
   * （兼容模式下宿主 `assemble()` 丢弃扩展字段，见规格 §3）。
   */
  readonly parts?: readonly PromptPart[] | undefined
  /**
   * 注册时刻的原文（注册方自己写下去的那份文本）。
   *
   * 与产物里的文本一比就知道 waterfall 有没有改写这一节：宿主 handler 拿到的是一份
   * 可改写的 `PromptPresentation`，改写后产物文本与注册原文不同。注册时还看不到
   * 改写，所以这里存**原文**，比较发生在投影时——两边都是真数据，不猜。
   */
  readonly registeredText?: string | undefined
}

/**
 * 空骨架：7 条来源固定顺序、组内无段、无不可归因段、无诊断。
 *
 * 只给**降级档**用（②③④ 装配没有发生，没有分段可言）。它让信封的形状成立，
 * 本身不是「装配发生了」的声明——那个声明由 `degraded` 的**缺席**表达；UI 的
 * 既有口径（降级档不摆来源组）保证它不会被读成「7 条来源这次都没贡献」。
 */
export function emptyPromptSegments(): PromptSegmentsView {
  return {
    sources: PROMPT_SOURCE_ORDER.map((source) => ({ source, segments: [] })),
    unattributed: [],
    diagnostics: [],
  }
}

/**
 * 读面能观测到、但产物里看不见的事实（票 82 §2 ③）。
 *
 * 预设（preset）与部署级 persona 在产物里**同名同形**，光看产物分不出谁遮蔽了
 * 谁。宿主读面能多知道一件事：这个 Agent 的 scope 上有没有 preset 在 compose
 * （`agentPresets.composedPreset(agent.ctx)`）。把它传进来，投影就能如实标注
 * 「这一段被遮蔽了，但遮蔽者长什么样我们看不见」——而不是假装没发生，也不是
 * 编一个遮蔽者出来。
 */
export interface PromptProjectionObservations {
  /**
   * 该 Agent 的 scope 上有 preset 在 compose。
   *
   * 为 true 时，`deployment:persona-*` 节带 `shadowedBy: { visibility: 'opaque' }`：
   * 预设的同名段把它遮住了，而预设那段文本不在本次装配产物里（兼容模式下宿主
   * 只交出胜出的那一份），所以只能说「不可见」。
   */
  readonly presetComposed?: boolean | undefined
}

/**
 * 把宿主装配产物与注册侧账本折成分段视图。
 *
 * @param assembly - 宿主 `assemble()` 的产物（结构镜像）。
 * @param ledger - 注册侧账本；缺席项按「没记」处理，不按「没有」。
 * @param observations - 读面观测到的、产物里看不见的事实（见
 *   {@link PromptProjectionObservations}）；缺席表示读面没观测，不表示「没有」。
 * @returns 按 7 条来源分组的段视图、不可归因段与诊断信号。
 */
export function buildPromptSegments(
  assembly: HostPromptAssembly,
  ledger: readonly PromptSectionLedgerEntry[],
  observations: PromptProjectionObservations = {},
): PromptSegmentsView {
  const byName = new Map<string, PromptSectionLedgerEntry>()
  for (const entry of ledger) {
    // 同名多条只认第一条：账本是注册方自己写的记录，重复键属于上游 bug，
    // 这里保持确定性而不是让顺序决定结果。
    if (!byName.has(entry.sectionName)) byName.set(entry.sectionName, entry)
  }

  const buckets = new Map<PromptSourceId, PromptSegment[]>(PROMPT_SOURCE_ORDER.map((source) => [source, []]))
  const unattributed: UnattributedPromptSegment[] = []

  for (const section of assembly.sections) {
    const entry = byName.get(section.name)
    const base = annotatedOf('section', section.name, section.text, entry)
    // 账本声明优先：同名节（②/③）在产物里不可区分，只能靠注册方自己说。
    const declared = entry?.source
    const source = declared ?? sourceOf(section.name, 'section')
    // 预设遮蔽：账本没说、但读面观测到有 preset 在 compose 时，如实标「不可见」。
    // 只标部署级 persona（规格 §2 ③ 说的就是这一对同名节），不扩散到别的来源。
    const shadow = base.shadowedBy === undefined && observations.presetComposed === true
      && section.name.startsWith('deployment:persona-')
      ? { shadowedBy: { visibility: 'opaque' as const } }
      : {}
    const annotated = { ...base, ...shadow }
    place(source === undefined ? annotated : { ...annotated, source }, buckets, unattributed)
  }
  for (const context of assembly.contexts) {
    const entry = byName.get(context.name)
    // 运行时 context 逐条按宿主 context 名归因（规格 §2 ⑥）。
    const base = annotatedOf('context', context.name, context.text, entry)
    place({ ...base, source: 'runtime-context' }, buckets, unattributed)
  }
  for (const tool of assembly.tools) {
    // 工具声明整组归 ToolsService 唯一 provider，不逐工具猜注册者（规格 §2 ⑦）。
    place({ source: 'tool-declaration', name: tool.name, surface: 'tool', text: tool.description }, buckets, unattributed)
  }

  const diagnostics: PromptSegmentDiagnostic[] = []
  for (const group of buckets.values()) {
    for (const segment of group) {
      if (segment.planName !== undefined && segment.planName !== segment.name) {
        diagnostics.push({
          code: 'alias-mismatch',
          name: segment.name,
          message: `宿主装配名 "${segment.name}" 与本仓规划名 "${segment.planName}" 不一致；以宿主名为准，规划名作别名。`,
        })
      }
    }
  }
  for (const entry of byName.values()) {
    if (presentInAssembly(assembly, entry.sectionName)) continue
    diagnostics.push({
      code: 'missing-from-assembly',
      name: entry.sectionName,
      message: `账本记了 "${entry.sectionName}"，但这次装配产物里没有它（可能不可执行，或未被注册）。`,
    })
  }

  return {
    sources: PROMPT_SOURCE_ORDER.map((source) => ({
      source,
      segments: sortSegments(buckets.get(source) ?? []),
    })),
    unattributed: sortSegments(unattributed),
    diagnostics: sortDiagnostics(diagnostics),
  }
}

/**
 * 一节的来源判定：只按宿主命名约定归因（② / ③ 的区分交给账本）。
 *
 * 认不出的一律返回 `undefined`，由调用方放进「不可归因」——不猜。
 */
function sourceOf(name: string, surface: PromptSegmentSurface): PromptSourceId | undefined {
  if (surface === 'context') return 'runtime-context'
  if (name === 'harness:identity') return 'harness-identity'
  if (name.startsWith('deployment:persona-')) return 'deployment-persona'
  if (name.startsWith('atelier:')) return 'atelier-section'
  if (name.startsWith('tools:')) return 'tool-guidance'
  // 归不了因：不猜（ADR-0009「不撒谎」）。
  return undefined
}

/**
 * 这一节有没有被 waterfall 改写。
 *
 * 优先级：注册方显式声明 > 注册原文与产物文本的实际比较。后者是本版新增的真数据
 * 来源——注册时存下原文，投影时与产物一比就知道。两者都没有时返回 `undefined`
 * （「不知道」），不是 `false`（「没改写」）：缺席与否定必须分得开。
 */
function rewriteOf(entry: PromptSectionLedgerEntry | undefined, productText: string): boolean | undefined {
  if (entry?.rewrittenByWaterfall !== undefined) return entry.rewrittenByWaterfall
  if (entry?.registeredText === undefined) return undefined
  return entry.registeredText !== productText
}

/** 一节的账本标注；只有账本真的记了才带上对应字段。 */
function annotatedOf(
  surface: PromptSegmentSurface,
  name: string,
  text: string,
  entry: PromptSectionLedgerEntry | undefined,
): PromptSegmentBase {
  return {
    name,
    surface,
    text,
    ...entry?.planName === undefined ? {} : { planName: entry.planName },
    ...entry?.layer === undefined ? {} : { layer: entry.layer },
    // 改写与否是**算出来**的：注册原文 vs 产物文本，两边都是真数据。
    // 注册方显式声明时以它为准（它可能知道更多，例如自己就在 handler 里改的）。
    ...rewriteOf(entry, text) === undefined ? {} : { rewrittenByWaterfall: rewriteOf(entry, text) },
    ...entry?.shadowedBy === undefined ? {} : { shadowedBy: entry.shadowedBy },
    ...entry?.parts === undefined ? {} : { parts: entry.parts },
  }
}

/** 落桶：有来源进对应组，没有来源进不可归因（不猜）。 */
function place(
  segment: PromptSegment | UnattributedPromptSegment,
  buckets: Map<PromptSourceId, PromptSegment[]>,
  unattributed: UnattributedPromptSegment[],
): void {
  if (segment.source === undefined) {
    unattributed.push(segment)
    return
  }
  buckets.get(segment.source)?.push(segment)
}

/** 产物里是否有这个二级键（任一通道）。 */
function presentInAssembly(assembly: HostPromptAssembly, name: string): boolean {
  return assembly.sections.some((section) => section.name === name)
    || assembly.contexts.some((context) => context.name === name)
    || assembly.tools.some((tool) => tool.name === name)
}

/** 组内稳定排序：宿主装配名的 code unit 升序（与宿主 registry 同序兜底一致）。 */
function sortSegments<T extends PromptSegmentBase>(segments: readonly T[]): T[] {
  return [...segments].sort((left, right) => compareNames(left.name, right.name))
}

/** 诊断稳定排序：先按码，再按名字。 */
function sortDiagnostics(diagnostics: readonly PromptSegmentDiagnostic[]): PromptSegmentDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const byCode = compareNames(left.code, right.code)
    return byCode !== 0 ? byCode : compareNames(left.name, right.name)
  })
}

/** code unit 比较：不依赖 locale / ICU，保证同一输入在任何环境下同序。 */
function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * 一段的段内块视图。
 *
 * 块只能来自注册侧账本（兼容模式下宿主 `assemble()` 丢弃扩展字段，见规格 §3），
 * 所以没有账本记录时**不假装可拆**：整段作为一个块给出，`expandable` 为 false。
 * 空块表同样不展开——「记了零块」与「没记」在渲染上是同一件事。
 */
export function promptSegmentParts(segment: PromptSegmentBase): PromptSegmentParts {
  const parts = segment.parts ?? []
  if (parts.length > 1) return { expandable: true, parts }
  return { expandable: false, parts: [{ name: segment.name, text: segment.text }] }
}

/**
 * 遮蔽标注的一行文案。
 *
 * `opaque` 必须如实说「不可见」——兼容模式下宿主节的遮蔽关系没有审计面，
 * 猜一个遮蔽者就是撒谎（ADR-0009 后果第 2 条）。
 */
export function promptShadowLabel(shadow: PromptShadow): string {
  return shadow.visibility === 'visible' ? `遮蔽了同名注册（${shadow.displaced}）` : '遮蔽关系不可见'
}
