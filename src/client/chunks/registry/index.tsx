/**
 * Registry chunk entry (ticket 59) — `lib/client.registry.js`.
 *
 * 两个 registry 页（模型关联 / 系统提示词）共用这一份 chunk：模型关联页由
 * model-links.tsx 提供（票 63 列表 + 空间/类别切换 + 详情），系统提示词页由
 * prompts.tsx 提供（票 68 生效层卡片 + 草稿 / 保存 / 回退 + 跨页高亮）。
 * chunk 自包含，唯一外部依赖是平台注入的 `react`；不能 import 主 bundle，也
 * 不能 import 另一个发布 chunk（chunks/list / chunks/editor）。
 *
 * 样式归属：页面样式仍由主 bundle 的 styles.css 注入（宿主按 data-plugin
 * 标记认领），本 chunk 只挂既有类名，不建 style 元素。props 只收宿主已解析的
 * 纯数据（ControlSnapshot），不拿 client / service 对象。
 */
export { ModelRegistryView } from './model-links.tsx'
export { PromptRegistryView } from './prompts.tsx'
