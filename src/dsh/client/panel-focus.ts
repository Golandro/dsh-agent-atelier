/**
 * 跨页聚焦通道（票 60）：页面持有的目标 + 目的地路由；纯函数，无 React。
 *
 * 三种目标（模型 / 别名 / 智能体）走同一条通道：
 *   request(focus, destination?) → 页面按 kind 选目的页签并挂起目标 →
 *   目的页定位（滚动 / 高亮，必要时切到合并空间）→ onFocusConsumed 清空。
 *
 * 默认目的地：model → prompts（模型页跳提示词页）、alias → models（别名跳
 * 模型关联页）、agent → agents（使用者跳智能体列表）。模型目标显式给
 * destination = 'models' 时落在模型关联页（新建模型后的聚焦等）。
 *
 * 「目标不在当前空间时回退合并空间」由目的页执行：空间段控归模型关联页
 * （票 63），壳层只保证 source（请求层）随目标传递，不替页内选空间。目标
 * 尚未进入快照（刚写入、回读未到）时不丢弃目标——目的页等数据到达再消费。
 */
import type { ControlSnapshot } from '../../control/index.ts'
import type { PanelFocus, RegistryDestination } from './chunk-contracts.ts'
import type { PanelTab } from './panel-types.ts'

export type { PanelFocus, PanelFocusKind, RegistryDestination } from './chunk-contracts.ts'

/** 目标默认落的页签；模型的显式 destination 可改落模型关联页。 */
export function panelTabOfFocus(focus: PanelFocus, destination?: RegistryDestination): PanelTab {
  if (focus.kind === 'agent') return 'agents'
  return destination ?? (focus.kind === 'model' ? 'prompts' : 'models')
}

/**
 * 智能体目标是否在当前快照里；不在就返回 null（页签照切成智能体列表，但
 * 不改选中——不假装列表里有这个 agent）。模型 / 别名目标不在这里解析：
 * 目的页按自己的 space 与行模型定位。
 */
export function focusedAgentName(focus: PanelFocus, snapshot: ControlSnapshot): string | null {
  if (focus.kind !== 'agent') return null
  return snapshot.agents.some((agent) => agent.agentName === focus.name) ? focus.name : null
}

/** 已挂起、等待目的页消费的一次跳转（页面持有）。 */
export interface FocusPending {
  readonly destination: RegistryDestination
  readonly focus: PanelFocus
}

/** 一次跳转请求的纯结果：页签 + 要选中的智能体 + 待消费目标（三选一）。 */
export interface FocusOutcome {
  readonly tab: PanelTab
  /** 非空 = 页面应立即选中的 agent（仅智能体目标，且目标在快照里）。 */
  readonly selection: string | null
  /** 非空 = 交给目的页定位、消费后清空的目标（模型 / 别名目标）。 */
  readonly pending: FocusPending | null
}

/**
 * 跨页跳转的唯一纯入口：页面拿到结果后只做三件事——切页签、按 selection
 * 选中（没有就不动选中）、挂起 pending。目标尚未进快照时也照常挂起：写后
 * 回读到达目的页再消费，不在壳层丢弃目标。
 */
export function routeFocusRequest(
  focus: PanelFocus,
  destination: RegistryDestination | undefined,
  snapshot: ControlSnapshot,
): FocusOutcome {
  const tab = panelTabOfFocus(focus, destination)
  if (tab === 'agents') {
    return { tab, selection: focusedAgentName(focus, snapshot), pending: null }
  }
  if (tab === 'models' || tab === 'prompts') {
    return { tab, selection: null, pending: { destination: tab, focus } }
  }
  return { tab, selection: null, pending: null }
}