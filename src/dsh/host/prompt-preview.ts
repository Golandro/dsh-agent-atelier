/**
 * 票 83：宿主读面 `POST /agent-atelier/prompt-preview` 的服务端实现。
 *
 * 一次预览就是**把真实装配路径跑一遍**（规格 §4）：解析 agent → 取 `agent.ctx`
 * 作 `AssemblyScope` → `tools.resolve()` → `systemPrompt.assemble()`，然后把产物、
 * 注册侧账本与本仓 `AssemblyPlan` 原样交出去。这里不重跑层合并、不在服务端做
 * 分段投影、也不替宿主补任何一节——分段投影是票 84 的纯函数，客户端拼。
 *
 * ## 四档降级（规格 §5）
 *
 * - ① 宿主面可用 + agent 可解析 → `assembly` + `ledger` + `plan`。
 * - ② 链耗尽 → `degraded.tier = 'chain-exhausted'`，引擎的 report 原样带出。
 * - ③ 宿主面不可用 → `degraded.tier = 'static'`，给本仓 plan，`missing` 逐项
 *   说明缺什么；能读到补丁合成后的有效 config 就一并给，读不到就说不读不到。
 * - ④ registry 读不到 → `degraded.tier = 'empty'`，空态 + 错误。
 *
 * 未知 agent 不降级：它按 wire 既有约定走 404 `not-found`（`UnknownAgentError`
 * 从这里穿过去，由 wire 映射），因为「名字不存在」是调用方的错，不是能力缺失。
 *
 * ## 两个必须守住的边界
 *
 * 1. **只读不等于无副作用**：`assemble()` 会真实执行 waterfall handler。声明在
 *    契约层（`PROMPT_PREVIEW_SIDE_EFFECTS`），并且每次都进返回值。
 * 2. **abort 不留半装配状态**：`ResolvedToolSet` 在 `finally` 里 dispose；取消
 *    原样抛出，不折成降级。
 */
import { AGENT_CONTROL_SERVICE, PROMPT_PREVIEW_SIDE_EFFECTS } from '../../contract/index.ts'
import { buildPromptSegments, emptyPromptSegments, planAssembly } from '../../assembly/index.ts'
import {
  ChainExhaustedError,
  UnknownAgentError,
  errorMessage,
  isAbortError,
  throwIfAborted,
} from '../../control/index.ts'
import { PROMPT_LEDGER_SERVICE } from './assembly.ts'
import { AGENT_LIVE_AGENTS_SERVICE } from './live-agents.ts'

import type { Context } from '@deepseek-ai/cordis'
import type {
  AssemblyPlan,
  AssemblySession,
  ChainResolutionReport,
  PromptPreviewAssembly,
  PromptPreviewDegradation,
  PromptPreviewLedgerEntry,
  PromptPreviewMissing,
  PromptPreviewMissingItem,
  PromptPreviewResponse,
  PromptPreviewStaticRow,
} from '../../contract/index.ts'
import type { PromptSectionLedgerEntry } from '../../assembly/index.ts'
import type { ComposedAgentSession } from '../../control/index.ts'
import type { HostLiveAgent, HostModelSelection, LiveAgents } from './live-agents.ts'

/** 一次预览请求：wire 已校验过 `agentName` 与 `cwd`。 */
export interface PromptPreviewRequest {
  readonly agentName: string
  /** `null` 表示用户全局（ADR-0007 的软边界）。 */
  readonly cwd: string | null
  /** 本次请求的扫描令牌，原样回显。 */
  readonly scanId: number
  readonly signal?: AbortSignal | undefined
}

/** 读面本体：一个方法，四档降级。 */
export interface PromptPreview {
  preview(request: PromptPreviewRequest): Promise<PromptPreviewResponse>
}

/** 宿主 `ToolsService.resolve` 的结构切片。 */
interface HostTools {
  resolve(context: {
    readonly agent: object
    readonly modelSelection: Readonly<HostModelSelection>
    readonly signal: AbortSignal
  }): Promise<{ dispose(): void }>
}

/** 宿主 `SystemPrompt.assemble` 的结构切片。 */
interface HostSystemPrompt {
  assemble(context: {
    readonly scope: object
    readonly modelSelection: Readonly<HostModelSelection>
    readonly toolSet: object
    readonly signal: AbortSignal
  }): Promise<PromptPreviewAssembly>
}

/** 宿主 loader 的一行：只读生效 config 需要的那两个字段。 */
interface HostLoaderEntry {
  readonly options?: { readonly id?: unknown; readonly name?: unknown } | undefined
  readonly fiber?: { readonly effectiveConfig?: unknown } | undefined
}

/** 宿主 loader 服务。 */
interface HostLoader {
  entries(): Iterable<HostLoaderEntry>
}

/** `system-prompt` 行的模块名后缀：补丁里那一行就是它。 */
const SYSTEM_PROMPT_ROW_SUFFIX = 'dsh-system-prompt'

/**
 * 建一个读面。服务在**调用时**才从 context 读，所以这个工厂可以在
 * `applyUiHost` 里先建好、由后面的行补上服务，不需要挂载顺序。
 */
export function createPromptPreview(ctx: Context): PromptPreview {
  return {
    async preview(request) {
      return previewOnce(ctx, request)
    },
  }
}

async function previewOnce(ctx: Context, request: PromptPreviewRequest): Promise<PromptPreviewResponse> {
  const signal = request.signal ?? new AbortController().signal
  throwIfAborted(signal)

  const control = ctx.get(AGENT_CONTROL_SERVICE) as
    | { composeSession(name: string, options?: { readonly cwd?: string | null | undefined }): Promise<ComposedAgentSession> }
    | undefined
  if (control === undefined) {
    return staticFallback(ctx, request, undefined, missing('session', `${AGENT_CONTROL_SERVICE} 不可用：读面拿不到会话参数，也就没有本仓规划`))
  }

  let session: ComposedAgentSession
  try {
    session = await control.composeSession(request.agentName, { cwd: request.cwd })
  } catch (error) {
    if (isAbortError(error)) throw error
    // 未知 agent 是调用方的错，不是能力缺失：交给 wire 映射成 404。
    if (error instanceof UnknownAgentError) throw error
    if (error instanceof ChainExhaustedError) return chainExhausted(request, error)
    // ④ registry 读不到：空态 + 错误，绝不吞成 500。
    return emptyState(request, error)
  }
  throwIfAborted(signal)

  const plan = safePlan(session)
  const live = ctx.get(AGENT_LIVE_AGENTS_SERVICE) as LiveAgents | undefined
  const agent = live?.get(request.agentName)
  if (agent === undefined) {
    return staticFallback(ctx, request, plan, missing('live-agent', `"${request.agentName}" 当前没有活跃会话：只有 summon_agent 建出来的 Agent 才有名字可查`))
  }

  const agentCtx = contextOf(agent)
  if (agentCtx === undefined) {
    return staticFallback(ctx, request, plan, missing('live-agent', '这个 Agent 没有可读的 scoped context，取不到它自己的服务'))
  }

  const selection = modelSelectionOf(agent)
  if (selection === undefined) {
    return staticFallback(ctx, request, plan, missing('model-selection', '宿主没有给出模型选择（agent.model.current() 为空），不替它编一个'))
  }

  const tools = serviceOf<HostTools>(agentCtx, 'tools')
  if (tools === undefined) {
    return staticFallback(ctx, request, plan, missing('tool-resolution', '这个 Agent 的 scope 上没有 tools 服务，工具可见集无从解析'))
  }

  const systemPrompt = serviceOf<HostSystemPrompt>(agentCtx, 'systemPrompt')
  if (systemPrompt === undefined) {
    return staticFallback(ctx, request, plan, missing('host-assembly', '这个 Agent 的 scope 上没有 systemPrompt 服务，装配无从发生'))
  }

  let toolSet: { dispose(): void }
  try {
    toolSet = await tools.resolve({ agent, modelSelection: selection, signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    return staticFallback(ctx, request, plan, missing('tool-resolution', errorMessage(error)))
  }

  let assembly: PromptPreviewAssembly
  try {
    assembly = await systemPrompt.assemble({ scope: agent, modelSelection: selection, toolSet, signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    // handler 是任意插件代码，它可以在回合之外抛；route 必须降级而不是冒 500。
    return staticFallback(ctx, request, plan, missing('host-assembly', errorMessage(error)))
  } finally {
    toolSet.dispose()
  }
  throwIfAborted(signal)

  const ledger = ledgerOf(ctx, agentCtx)
  return {
    cwd: request.cwd,
    scanId: request.scanId,
    assembledAt: new Date().toISOString(),
    assembly,
    ledger,
    // 投影在宿主侧发生（票 82/85）：投影函数在装配层，浏览器 chunk 按 import 矩阵
    // 读不到它，所以由这里把产物 + 账本折成分段视图，随回答一起送出。
    // 档位 ②③④ 走各自的降级构造函数，那里**没有** segments —— 没装配就没有分段，
    // 不拿「7 个空组」冒充「装配了但这次没贡献」（那是另一种事实）。
    segments: buildPromptSegments(assembly, ledger as readonly PromptSectionLedgerEntry[]),
    plan,
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: [
      freshnessNote(),
      // ADR-0009：账本只有自带账本的注册方写，所以空表不等于「这次没有节」。
      ...ledger.length === 0
        ? ['本次装配的 scope 上没有本仓注册的节：产物里的节来自别的插件，它们不写本仓账本，因此不归因。']
        : [],
    ],
  }
}

/** ② 链耗尽：引擎的 report 原样带出，装配没有发生。 */
function chainExhausted(request: PromptPreviewRequest, error: ChainExhaustedError): PromptPreviewResponse {
  const degradation: PromptPreviewDegradation = {
    tier: 'chain-exhausted',
    reason: error.message,
    report: error.report as ChainResolutionReport,
    missing: [missing('session', '链耗尽：没有选中的路由，就没有可装配的会话')],
  }
  return {
    cwd: request.cwd,
    scanId: request.scanId,
    assembledAt: new Date().toISOString(),
    ledger: [],
    // ② 装配没有发生：给空骨架，让形状恒定（不是「7 条来源都没贡献」）。
    segments: emptyPromptSegments(),
    degraded: degradation,
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: [freshnessNote(), '档位 ②：装配没有发生，因此没有 assembly；report 是链解析引擎的原样输出。'],
  }
}

/** ④ registry 读不到：空态 + 错误。 */
function emptyState(request: PromptPreviewRequest, error: unknown): PromptPreviewResponse {
  return {
    cwd: request.cwd,
    scanId: request.scanId,
    assembledAt: new Date().toISOString(),
    ledger: [],
    segments: emptyPromptSegments(),
    degraded: {
      tier: 'empty',
      reason: errorMessage(error),
      missing: [missing('session', 'registry 读不到：连 agent 文档与模型链都取不到，没有可预览的对象')],
    },
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: [freshnessNote(), '档位 ④：空态。错误原文在 degraded.reason，未改写。'],
  }
}

/**
 * ③ 静态回退：宿主面不可用，但本仓的规划不依赖宿主，仍然给。
 *
 * 能读到补丁合成后**已求值**的 `system-prompt` 行 config 就给 `staticConfig`；
 * 读不到就逐项说读不到——`entry.options.config` 还带着未求值的 `!!js` 表达式，
 * 拿它充当生效值就是在撒谎。
 */
function staticFallback(
  ctx: Context,
  request: PromptPreviewRequest,
  plan: AssemblyPlan | undefined,
  first: PromptPreviewMissing,
): PromptPreviewResponse {
  const missingItems: PromptPreviewMissing[] = [first]
  const staticConfig = readStaticConfig(ctx)
  if (staticConfig === undefined) {
    missingItems.push(missing('host-config', '拿不到有效 config：loader 上没有 system-prompt 行，或那一行的 fiber 还没激活（未求值的 options.config 不算生效值）'))
  }
  return {
    cwd: request.cwd,
    scanId: request.scanId,
    assembledAt: new Date().toISOString(),
    ...staticConfig === undefined ? {} : { staticConfig },
    ledger: [],
    segments: emptyPromptSegments(),
    ...plan === undefined ? {} : { plan },
    degraded: {
      tier: 'static',
      reason: first.reason,
      missing: missingItems,
    },
    sideEffects: PROMPT_PREVIEW_SIDE_EFFECTS,
    notes: [
      freshnessNote(),
      '档位 ③：这不是宿主装配结果——没有跑 assemble()，没有 waterfall，也没有工具声明。',
      ...staticConfig === undefined ? [] : ['staticConfig 来自宿主 loader 的 fiber.effectiveConfig（补丁合成后、!!js 已求值）。'],
    ],
  }
}

/**
 * 读补丁合成后的 `system-prompt` 行生效 config；一条都读不到时返回 `undefined`。
 *
 * 形状照 .vendor 里的源码钉：`Loader extends EntryTree`，`entries()` 是生成器
 * （`vendor/loader/src/config/tree.ts:64-70`）；`Entry.options` 是 `{id,name,config,…}`
 * （`config/entry.ts:10-23`），`Entry.fiber?: Fiber`（`:47`）；`fiber.effectiveConfig`
 * 是 `_effectiveConfig` 的 getter（`vendor/cordis/src/fiber.ts:664-666`），**未激活前
 * 是 undefined**，所以这里逐行判 undefined，不做「取不到就用原文」的兜底。
 * `ctx.root.get('loader')`：loader 提供在根 context 上（`Context.root`，`context.ts:21-22`），
 * ui-host 行自己的 ctx 未必是根。
 *
 * 验证口径：`@deepseek-ai/cordis-plugin-loader` 不是本仓 devDependency（bundle 不能
 * 依赖宿主包），所以这条路径用结构 fixture 验（`test/host-prompt-preview.test.ts`
 * 的「有效 config 口径」两条）：一条证明没有 effectiveConfig 时不给 staticConfig、
 * 且未求值的 options.config 不会漏进返回值；一条证明有 effectiveConfig 时只挑
 * system-prompt 那一行。真机上读不到就走 `host-config` 缺口，绝不拿原文顶替。
 */
function readStaticConfig(ctx: Context): readonly PromptPreviewStaticRow[] | undefined {
  const loader = ctx.root.get('loader') as HostLoader | undefined
  if (loader === undefined || typeof loader.entries !== 'function') return undefined
  const rows: PromptPreviewStaticRow[] = []
  let index = 0
  for (const entry of loader.entries()) {
    index += 1
    const name = entry.options?.name
    if (typeof name !== 'string' || !name.endsWith(SYSTEM_PROMPT_ROW_SUFFIX)) continue
    const config = entry.fiber?.effectiveConfig
    if (config === undefined) continue
    const id = entry.options?.id
    rows.push({ id: typeof id === 'string' ? id : String(index), name, config })
  }
  return rows.length === 0 ? undefined : rows
}

/** 注册侧账本：与 sink 写入时用的同一个 scope 键（Agent 的 scoped context）。 */
function ledgerOf(ctx: Context, agentCtx: object): readonly PromptPreviewLedgerEntry[] {
  const ledger = ctx.get(PROMPT_LEDGER_SERVICE) as { of(scope: object): readonly PromptPreviewLedgerEntry[] } | undefined
  if (ledger === undefined) return []
  return ledger.of(agentCtx)
}

/** 规划失败不该毁掉一次预览：规划是纯函数，真抛了就当没有。 */
function safePlan(session: ComposedAgentSession): AssemblyPlan | undefined {
  try {
    return planAssembly(session as unknown as AssemblySession)
  } catch {
    return undefined
  }
}

function contextOf(agent: HostLiveAgent): Context | undefined {
  const candidate: unknown = agent.ctx
  if (typeof candidate !== 'object' || candidate === null) return undefined
  return typeof (candidate as { get?: unknown }).get === 'function' ? candidate as Context : undefined
}

function modelSelectionOf(agent: HostLiveAgent): Readonly<HostModelSelection> | undefined {
  const current = agent.model?.current
  if (typeof current !== 'function') return undefined
  const selection: unknown = current.call(agent.model)
  if (typeof selection !== 'object' || selection === null) return undefined
  const { provider, model } = selection as { provider?: unknown; model?: unknown }
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined
  return selection as Readonly<HostModelSelection>
}

function serviceOf<T>(ctx: Context, name: string): T | undefined {
  const candidate: unknown = ctx.get(name)
  if (typeof candidate !== 'object' || candidate === null) return undefined
  return candidate as T
}

function missing(item: PromptPreviewMissingItem, reason: string): PromptPreviewMissing {
  return { item, reason }
}

/** 新鲜度口径：只有装配时刻与 scanId，没有 mtime。 */
function freshnessNote(): string {
  return '新鲜度：只带装配时刻（assembledAt）与本次请求的 scanId；本仓没有文档 mtime 的数据源，因此不提供 mtime，也不假装文档是新的。'
}