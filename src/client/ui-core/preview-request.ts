/**
 * 预览读面的页面侧接线（票 85）。
 *
 * 谁调什么：
 * - chunk 只认 `onPreviewRequest(agentName, signal?)`，返回**已投影好的**分段视图；
 * - 主壳（page.tsx）是唯一持有 `ControlClient` 的地方，所以回调必须在这里造；
 * - 宿主读面把原始装配产物投影成 `PromptSegmentsView`（`buildPromptSegments` 在
 *   `src/assembly/`，主壳按 import 矩阵读不到，chunk 更读不到）。
 *
 * 本模块只做接线与形状收窄，不重跑装配、不重跑层合并、不自己投影。
 *
 * 为什么用结构切片而不是 `ControlClient` 的成员：控制端口的成员表是**冻结**的
 * （`test/plugin.test.ts` 钉住），预览走 wire 的路由层、不进 control 端口
 * （brief §8 #9）。所以这里按结构读一个可选的 `promptPreview`：端口上有就接线，
 * 没有就如实返回 `undefined`，面板据此禁用按钮并说明「没有接入预览读面」——
 * 不假装可用，也不在客户端发明一次装配。
 */
import type { PromptPreviewHandler, PromptPreviewView } from '../../dsh/client/chunk-contracts.ts'
import type { PromptPreviewPort } from '../../control/index.ts'

/**
 * 预览读面的结构切片由 `src/control/preview.ts` 拥有（`PromptPreviewPort`），
 * 这里只 re-export 给主壳用——**不保留第二份定义**。client 本来就可以读 control
 * 的公共入口（import 矩阵 `CLIENT_ENTRIES`），没有理由在 ui-core 再抄一份。
 */
export type { PromptPreviewPort }

/** 客户端是否带了预览读面（结构判定，不看实现类型）。 */
export function hasPromptPreview(client: unknown): client is PromptPreviewPort {
  if (client === null || typeof client !== 'object') return false
  const candidate = (client as { promptPreview?: unknown }).promptPreview
  return typeof candidate === 'function'
}

/**
 * 造一个页面侧的预览回调；客户端没有预览读面时返回 `undefined`。
 *
 * `cwd` 跟随页面当前工作空间（与 `chainReport` 同一条口径）：切空间后预览读的
 * 必须是新空间的 agent 文档。
 */
export function previewHandlerOf(
  client: unknown,
  cwd: string | undefined,
): PromptPreviewHandler | undefined {
  if (!hasPromptPreview(client)) return undefined
  return async (agentName: string, signal?: AbortSignal): Promise<PromptPreviewView> =>
    await client.promptPreview(agentName, { cwd, signal })
}
