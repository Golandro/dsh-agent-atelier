/**
 * Registry chunk entry (ticket 59) — `lib/client.registry.js`.
 *
 * 两个 registry 页（模型关联 / 系统提示词）共用这一份 chunk：本票只交付
 * 「视图入口 + ListPane 外壳」，页面内容按票 63/68 接入。chunk 自包含，
 * 唯一外部依赖是平台注入的 `react`；不能 import 主 bundle，也不能 import
 * 另一个发布 chunk（client-list / client-editor）。
 *
 * 样式归属：页面样式仍由主 bundle 的 styles.css 注入（宿主按 data-plugin
 * 标记认领），本 chunk 只挂既有类名，不建 style 元素。props 只收宿主已解析的
 * 纯数据（ControlSnapshot），不拿 client / service 对象。
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import type { RegistryViewProps } from '../src/dsh/client/chunk-contracts.ts'
import { ListPane } from './list-pane.tsx'

interface RegistryPaneProps {
  readonly kind: 'models' | 'prompts'
  readonly title: string
  readonly count: number
}

/** 两页共用的空壳：外壳 + 标题计数；行内容与工具区由后续票注入。 */
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

export function ModelRegistryView(props: RegistryViewProps): ReactNode {
  return h(RegistryPane, { kind: 'models', title: '模型关联', count: props.snapshot.models.length })
}

export function PromptRegistryView(props: RegistryViewProps): ReactNode {
  return h(RegistryPane, { kind: 'prompts', title: '系统提示词', count: props.snapshot.models.length })
}
