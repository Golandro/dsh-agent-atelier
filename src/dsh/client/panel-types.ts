/**
 * 插件面板的视图状态（票 05）。
 *
 * 头部把三个视图做成页签：`agents` = 智能体列表 + 编辑器（当前主视图）；
 * `history` = 操作历史（原「最近写入」状态栏的内容）；`config` = 配置占位。
 */
export type PanelTab = 'agents' | 'history' | 'config'

/** invalidate 流程的状态（页面持有；头部只呈现，不参与刷新逻辑）。 */
export type ReloadState =
  | { readonly status: 'idle' }
  | { readonly status: 'reloading' }
  | { readonly status: 'failed'; readonly message: string }
