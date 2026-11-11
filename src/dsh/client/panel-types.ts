/**
 * 插件面板的视图状态（票 05；票 60 扩为四个顶层页签）。
 *
 * 头部把四个视图做成页签：`agents` = 智能体列表 + 编辑器（主视图）；
 * `models` = 模型关联（registry chunk）；`prompts` = 系统提示词（同一
 * registry chunk）；`history` = 操作历史。视图都保持挂载，用 hidden 切换。
 */
export type PanelTab = 'agents' | 'models' | 'prompts' | 'history'

/** 页签对应的 tabpanel id；头部 aria-controls 与视图根节点共用这一处。 */
export function panelViewId(tab: PanelTab): string {
  return `panel-view-${tab}`
}

/** invalidate 流程的状态（页面持有；头部只呈现，不参与刷新逻辑）。 */
export type ReloadState =
  | { readonly status: 'idle' }
  | { readonly status: 'reloading' }
  | { readonly status: 'failed'; readonly message: string }

/** 页签键盘导航的纯判定结果（与 workspaceSelectKey 同形的可测 seam）。 */
export interface PanelTabKeyMove {
  readonly handled: boolean
  /** 落点页签下标；未认领的键返回当前下标。 */
  readonly next: number
}

/**
 * 页签行的键盘契约（ARIA tabs 的自动激活形态）：←/→ 循环、Home/End
 * 首尾。只认这些键；带修饰键的组合由调用方先放行（不抢浏览器/OS）。
 *
 * 纯函数：头部只负责把结果落到 onTab 与焦点上，键盘规则本身可单测。
 */
export function panelTabKey(index: number, count: number, key: string): PanelTabKeyMove {
  if (count <= 0) return { handled: false, next: 0 }
  const current = index >= 0 && index < count ? index : 0
  switch (key) {
    case 'ArrowRight':
      return { handled: true, next: (current + 1) % count }
    case 'ArrowLeft':
      return { handled: true, next: (current - 1 + count) % count }
    case 'Home':
      return { handled: true, next: 0 }
    case 'End':
      return { handled: true, next: count - 1 }
    default:
      return { handled: false, next: current }
  }
}
