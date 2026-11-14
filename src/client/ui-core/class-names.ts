/**
 * 结构节点的 DOM 类名（票 05）。
 *
 * 大块结构（页面 / 列表 / 编辑器 / 分隔条 / 占位 / 最近写入）统一带插件命名空间
 * 类 `PLUGIN_NS_CLASS`，再跟各自的局部类名：DevTools 里一眼能归属到本插件，也不会
 * 和宿主或其它插件的 `.editor` / `.list` 这类通用名撞在一起。
 *
 * 命名空间类必须来自变量（= package.json 的 name），不要在 JSX 里写死字符串；
 * 样式作用域仍以 `.agent-atelier-page` 为锚点（见 styles.css 头部说明），
 * 命名空间类只负责可读性与归属，不参与选择器。
 *
 * 依赖纪律：本模块只导出常量/纯函数，不引入任何运行时依赖。
 */

/** 插件命名空间类：与 `package.json` 的 `name` 一致。 */
export const PLUGIN_NS_CLASS = 'dsh-agent-atelier'

/** 页面根：样式作用域锚点 + 分栏拖拽态的挂载点（pane.tsx 的 closest 查找）。 */
export const PAGE_ROOT_CLASS = 'agent-atelier-page'

/** 组合「插件命名空间 + 局部类名」，例如 `nsClass('agent-editor')`。 */
export function nsClass(local: string): string {
  return `${PLUGIN_NS_CLASS} ${local}`
}
