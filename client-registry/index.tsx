/**
 * Registry chunk entry (ticket 59) — `lib/client.registry.js`.
 *
 * 两个 registry 页（模型关联 / 系统提示词）共用这一份 chunk：模型关联页由
 * model-links.tsx 提供（票 63 列表 + 空间/类别切换），系统提示词页仍是空壳，
 * 页面内容归票 68。chunk 自包含，唯一外部依赖是平台注入的 `react`；不能
 * import 主 bundle，也不能 import 另一个发布 chunk（client-list / client-editor）。
 *
 * 样式归属：页面样式仍由主 bundle 的 styles.css 注入（宿主按 data-plugin
 * 标记认领），本 chunk 只挂既有类名，不建 style 元素。props 只收宿主已解析的
 * 纯数据（ControlSnapshot），不拿 client / service 对象。
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import type { RegistryViewProps } from '../src/dsh/client/chunk-contracts.ts'
import { ListPane } from './list-pane.tsx'

export { ModelRegistryView } from './model-links.tsx'

interface RegistryPaneProps {
  readonly kind: 'prompts'
  readonly title: string
  readonly count: number
}

/** 系统提示词页的空壳：外壳 + 标题计数；页面内容由票 68 接入。 */
function RegistryPane(props: RegistryPaneProps): ReactNode {
  return h(
    'section',
    { className: 'registry-page', 'data-registry-view': props.kind },
    h(ListPane, {
      title: props.title,
      count: `${props.count} 条目`,
      className: 'registry-pane',
      children: null,
    }),
  )
}

export function PromptRegistryView(props: RegistryViewProps): ReactNode {
  return h(RegistryPane, { kind: 'prompts', title: '系统提示词', count: props.snapshot.models.length })
}
