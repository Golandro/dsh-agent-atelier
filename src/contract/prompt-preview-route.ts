/**
 * 票 83：宿主读面的线上契约。
 *
 * `POST /agent-atelier/prompt-preview` 把宿主 `systemPrompt.assemble()` 的产物
 * 原样交出去，外加注册侧账本与本仓的 `AssemblyPlan`；**不做分段投影**（票 84 的
 * 纯函数在装配侧，客户端把它们和这份原始数据拼起来）。
 *
 * ## 只读 ≠ 无副作用
 *
 * 这条路由不改文档、不改 registry、不写会话，但它会**真实执行**
 * `system-prompt/assemble` waterfall 的每个 handler——handler 是任意插件代码，
 * 可能做 IO、写缓存、发日志。声明不写在文档里就完事，它同时进返回值
 * （{@link PromptPreviewResponse.sideEffects}），因为调用方是浏览器里的 UI，
 * 它拿不到这里的中文注释。
 *
 * ## 为什么 assembly 用本文件自己的结构镜像
 *
 * 装配侧（`src/assembly/segments.ts`）已经有一份 `HostPromptAssembly` 镜像，
 * 那是**投影的入参**；这里是**线上传输的形状**（只允许 JSON 值，且要在浏览器
 * 侧可读）。两者结构一致但角色不同：前者是宿主形状的镜像，后者是线上 DTO。
 * 契约层不能 import 装配层，所以这里自带一份，由 `test/host-prompt-preview.test.ts`
 * 钉住两者可互相赋值。
 */
import type { ChainResolutionReport } from './types.ts'
import type { AssemblyPlan } from './assembly.ts'
import type { PromptPart, PromptShadow, PromptSourceId } from './prompt-preview.ts'

/** 线上装配产物里的一节：宿主 `AssembledSection` 的 JSON 形状。 */
export interface PromptPreviewSection {
  readonly name: string
  readonly text: string
  readonly interpolate?: boolean | undefined
}

/** 线上装配产物里的一条运行时 context：宿主 `AssembledContext` 的 JSON 形状。 */
export interface PromptPreviewContext {
  readonly name: string
  readonly text: string
  readonly interpolate?: boolean | undefined
}

/** 线上装配产物里的一条工具声明：宿主 `ToolSchema` 的 JSON 形状。 */
export interface PromptPreviewToolDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly deferLoading?: true | undefined
}

/**
 * 宿主 `assemble()` 的产物，原样透传。
 *
 * 四个通道都在：分段（`sections`）、运行时 context（`contexts`）、插值变量
 * （`variables`）与工具声明（`tools`）。投影方按 `name` 对齐账本，本契约不预
 * 先分组——分组是票 84 的事。
 */
export interface PromptPreviewAssembly {
  readonly sections: readonly PromptPreviewSection[]
  readonly contexts: readonly PromptPreviewContext[]
  readonly variables: Readonly<Record<string, string | undefined>>
  readonly tools: readonly PromptPreviewToolDeclaration[]
}

/**
 * 注册侧账本的一条记录，线上形状。
 *
 * 定义在装配侧（`src/assembly/segments.ts` 的 `PromptSectionLedgerEntry`，票 84
 * 冻结的字段集），这里只是它在契约层的镜像：账本由注册方写，读面只搬运。
 * 两个类型必须可互相赋值，由测试钉住。
 */
export interface PromptPreviewLedgerEntry {
  /** 宿主装配名，与 {@link PromptPreviewAssembly.sections} 里的 `name` 对齐。 */
  readonly sectionName: string
  /** 本仓规划名；与 `sectionName` 不同即为别名不一致。 */
  readonly planName?: string | undefined
  /** 注册方声明的来源。 */
  readonly source?: PromptSourceId | undefined
  /** 这段文本来自哪个配置文件（若有）。 */
  readonly layer?: string | undefined
  /** 注册方观测到 waterfall 改写了自己注册的文本。 */
  readonly rewrittenByWaterfall?: boolean | undefined
  /** 这段被同名节遮蔽；只有自带账本的注册方知道。 */
  readonly shadowedBy?: PromptShadow | undefined
  /** 段内块。 */
  readonly parts?: readonly PromptPart[] | undefined
}

/** 降级档位（规格 §5）：① 完整装配时没有这个字段。 */
export type PromptPreviewTier = 'chain-exhausted' | 'static' | 'empty'

/**
 * 三档降级名字，顺序固定（②③④）。
 *
 * ① 不在这里：它是「没有 degraded 字段」，不是第四个字符串——让 UI 用
 * `degraded === undefined` 判完整装配，比多一个 `'full'` 常量更难写错。
 */
export const PROMPT_PREVIEW_TIERS: readonly PromptPreviewTier[] = ['chain-exhausted', 'static', 'empty']

/** 请求体：wire 只收这两个字段。 */
export interface PromptPreviewRequestBody {
  /** atelier 的 agent 名字（不是宿主会话 id）。 */
  readonly agentName: string
  /** 扫描起点；缺席/null 表示用户全局（ADR-0007 的软边界）。 */
  readonly cwd?: string | null | undefined
}

/** 静态回退时逐项列出的缺口。 */
export type PromptPreviewMissingItem =
  | 'session'
  | 'live-agent'
  | 'model-selection'
  | 'tool-resolution'
  | 'host-assembly'
  | 'host-config'

/** 一项缺口：缺什么，为什么缺。 */
export interface PromptPreviewMissing {
  readonly item: PromptPreviewMissingItem
  readonly reason: string
}

/** 降级说明：到哪一档、为什么、还缺什么。 */
export interface PromptPreviewDegradation {
  readonly tier: PromptPreviewTier
  /** 给人看的一句话；宿主/引擎自己的消息原样带出，不改写。 */
  readonly reason: string
  /** 档位 ② 的链解析报告（引擎原样），其余档位缺席。 */
  readonly report?: ChainResolutionReport | undefined
  readonly missing: readonly PromptPreviewMissing[]
}

/**
 * 静态回退里的一行补丁配置：补丁合成后真正生效的 `system-prompt` 行 config。
 *
 * `config` 是宿主 loader 的 `fiber.effectiveConfig`（`!!js` 已求值），**不是**
 * `entry.options.config` 的原文——后者还带着未求值的表达式，当成生效值就是在
 * 撒谎。拿不到有效值时这里就没有这一行，缺口进 {@link PromptPreviewDegradation.missing}。
 */
export interface PromptPreviewStaticRow {
  /** 行 id（`entry.options.id`），缺席时退化成索引。 */
  readonly id: string
  /** 行名（`entry.options.name`）。 */
  readonly name: string
  /** 已求值的生效 config。 */
  readonly config: unknown
}

/**
 * 一次预览的完整回答。
 *
 * 档位与字段的对应关系（规格 §5）：
 * - ① 完整装配：`assembly` + `ledger` + `plan`，没有 `degraded`。
 * - ② 链耗尽：`degraded.tier = 'chain-exhausted'` + `degraded.report`，没有 `assembly`。
 * - ③ 宿主面不可用：`degraded.tier = 'static'` + `plan`（本仓规划不依赖宿主）
 *   + 可能有的 `staticConfig`，`missing` 逐项说明缺什么。
 * - ④ registry 读不到：`degraded.tier = 'empty'`，什么都没有。
 *
 * 未知 agent 不走降级：它按 wire 既有约定回 404 `not-found`。
 */
export interface PromptPreviewResponse {
  /** 本次请求的扫描起点，`null` 表示用户全局（ADR-0007 的软边界）。 */
  readonly cwd: string | null
  /** 本次请求的扫描令牌，与 `/state` 同一计数器，用来丢弃过期回答。 */
  readonly scanId: number
  /** 装配时刻（ISO 8601）。**不是**文档 mtime：本仓没有 mtime 数据源。 */
  readonly assembledAt: string
  /** 宿主 `assemble()` 的产物；档位 ②③④ 缺席。 */
  readonly assembly?: PromptPreviewAssembly | undefined
  /** 注册侧账本；档位 ②③④ 为空表（不是「没有节」，是「这次没装配」）。 */
  readonly ledger: readonly PromptPreviewLedgerEntry[]
  /** 本仓的装配规划；档位 ①②③ 都在（纯函数，不依赖宿主）。 */
  readonly plan?: AssemblyPlan | undefined
  /** 补丁合成后生效的 `system-prompt` 行 config；只有档位 ③ 且读得到时才有。 */
  readonly staticConfig?: readonly PromptPreviewStaticRow[] | undefined
  /** 降级说明；档位 ① 缺席。 */
  readonly degraded?: PromptPreviewDegradation | undefined
  /** 这条路由的副作用声明；每次回答都带，UI 直接展示。 */
  readonly sideEffects: readonly string[]
  /** 其余事实：新鲜度口径等。 */
  readonly notes: readonly string[]
}

/** 副作用的固定说法：契约层持有唯一一份，路由与 UI 都读它。 */
export const PROMPT_PREVIEW_SIDE_EFFECTS: readonly string[] = [
  '本接口会真实执行 system-prompt/assemble waterfall 的每个 handler：任何插件注册的 handler 都会被调用，它自己的副作用（IO、缓存、日志）照常发生。',
  '只读指的是不改 agent 文档、不改 registry、不写会话；不是「无副作用」。',
  '装配产物是「此刻这一次调用」的结果，不等于任何真实回合：handler 可以按自己的状态返回不同文本，工具声明也只是本次解析的可见集。',
]
