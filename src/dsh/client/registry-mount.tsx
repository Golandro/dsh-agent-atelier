/**
 * Registry chunk 挂载缝（票 59）。
 *
 * - loadRegistryChunk() 懒加载 lib/client.registry.js；两个 registry 视图共用
 *   同一个 chunk，宿主对同一 chunk 的并发加载自带去重（importChunk 的
 *   pendingArrival），所以这里不另建缓存。
 * - 加载中 / 失败带明确文案，失败态 role=alert 且带「重试」——重试重新走一次
 *   require.async，不白屏。
 * - chunk 视图只收 snapshot（纯数据）、聚焦目标与 on* 回调；本挂载器不把
 *   client / service 对象递进去。
 * - 样式归属：页面样式仍由主 bundle 的 data-plugin 标记注入；挂载器与 chunk
 *   都不建 style 元素，宿主 claimStyles/removeOwnedStyles 不会摘掉页面样式。
 */
import { createElement as h } from 'react'
import { useAbortableLoad } from './abortable-load.ts'
import { loadRegistryChunk } from './chunk-loader.ts'
import { nsClass } from './class-names.ts'

import type { RegistryViewProps } from './chunk-contracts.ts'
import type { ReactNode } from 'react'

export type RegistryViewKind = 'models' | 'prompts'

export interface RegistryMountProps extends RegistryViewProps {
  readonly view: RegistryViewKind
}

/** 加载态文案用的页名（模型关联 / 系统提示词）。 */
const VIEW_LABEL: Readonly<Record<RegistryViewKind, string>> = {
  models: '模型关联',
  prompts: '系统提示词',
}

export function RegistryMount(props: RegistryMountProps): ReactNode {
  // chunk 懒加载与失败重试走共享状态机（票 26 / 簇 G）。
  const chunk = useAbortableLoad(loadRegistryChunk)
  const label = VIEW_LABEL[props.view]

  if (chunk.status === 'loading') {
    return h('div', { className: 'list-chunk-status' }, `${label}加载中…`)
  }
  if (chunk.status === 'error') {
    return h('div', { className: 'list-chunk-status list-chunk-status-error', role: 'alert' },
      h('p', null, `${label}加载失败：${chunk.error}`),
      h('button', { type: 'button', className: 'btn btn-sm', onClick: chunk.retry }, '重试'))
  }
  // chunk 契约的返回类型是 unknown（chunk 侧不依赖 React 类型）；这里与列表挂载器同样收窄成组件签名。
  const View = (props.view === 'models'
    ? chunk.value.ModelRegistryView
    : chunk.value.PromptRegistryView) as (viewProps: RegistryViewProps) => ReactNode
  return h('div', { className: nsClass('registry-mount') }, h(View, {
    snapshot: props.snapshot,
    focus: props.focus ?? null,
    onFocusConsumed: props.onFocusConsumed,
    onRequestFocus: props.onRequestFocus,
    onRegistryWrite: props.onRegistryWrite,
    registryWriteBusy: props.registryWriteBusy,
    onChainReport: props.onChainReport,
  }))
}
