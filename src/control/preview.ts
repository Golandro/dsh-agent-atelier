/**
 * 预览读面的客户端侧收口（票 85）：线上回答 → 渲染信封，以及端口形状。
 *
 * ## 为什么是交叉类型，不是改 `ControlClient`
 *
 * `ControlClient` 的成员表是冻结的集成面（ticket 12/13 的适配器对照与宿主侧
 * 成员表都按它对齐）。预览是**可选能力**：宿主行没挂读面时端口上就没有这个
 * 方法，UI 据此禁用按钮并说明「没有接入预览读面」（I3 的结构切片就是为此写的）。
 * 所以这里用交叉类型补上它，而不是往冻结接口里加成员——加进去等于宣称
 * 「每个 ControlClient 都能预览」，而那不是事实。
 *
 * ## 为什么这里不做投影、也不造空骨架
 *
 * 投影函数（`buildPromptSegments`）在装配层；空骨架也随它一起归装配层
 * （`emptyPromptSegments`）。宿主读面在服务端把两者都填好，线上回答的
 * `segments` 因此**总是存在**——本模块只搬字段，不需要、也不该在浏览器侧
 * 重造一份来源顺序（那份顺序是契约事实，重造就是第二份定义）。
 */
import type { ControlClient, ControlClientOptions } from './client.ts'
import type { PromptPreviewResponse, PromptPreviewView } from '../contract/index.ts'

/**
 * 预览读面在客户端上的形状：一次按需请求，回已投影好的信封。
 *
 * 与 I3 的 `preview-request.ts` 的结构切片同形（那边按结构判定，不看实现类型）。
 */
export interface PromptPreviewPort {
  promptPreview(agentName: string, options?: ControlClientOptions): Promise<PromptPreviewView>
}

/** 带预览读面的控制端口：冻结的 `ControlClient` 加一项可选能力。 */
export type PreviewCapableControlClient = ControlClient & PromptPreviewPort

/**
 * 线上回答 → 渲染信封。
 *
 * 纯搬移：`segments` 由宿主读面填好（档位 ① 是真投影，②③④ 是空骨架），
 * 本函数不改写宿主 / 引擎自己的消息，也不替它判断档位。
 */
export function previewViewOf(response: PromptPreviewResponse, agentName: string): PromptPreviewView {
  return {
    agentName,
    cwd: response.cwd,
    assembledAt: response.assembledAt,
    scanId: response.scanId,
    segments: response.segments,
    ...response.degraded === undefined ? {} : { degraded: response.degraded },
    sideEffects: response.sideEffects,
    notes: response.notes,
  }
}
