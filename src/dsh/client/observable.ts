/**
 * 宿主客户端服务的「可订阅快照」面（票 37）。
 *
 * 本插件不 import 宿主包（ADR-0001），只按形状认：`{ getSnapshot(), subscribe() }`。
 * 形状不对（服务没挂、版本换了、对象是代理）一律当成「没有」，由调用方降级，
 * 绝不在渲染期抛错。
 */

/** 只读快照 + 订阅；与 DSH 客户端的 `ObservableSnapshot` 同形。 */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 从任意服务对象里取快照面；不是这个形状就是没有。 */
export function observableOf<T>(service: unknown): ObservableSnapshot<T> | undefined {
  if (typeof service !== 'object' || service === null) return undefined
  const list = (service as { readonly list?: unknown }).list
  if (typeof list !== 'object' || list === null) return undefined
  const candidate = list as { readonly getSnapshot?: unknown; readonly subscribe?: unknown }
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return list as ObservableSnapshot<T>
}
