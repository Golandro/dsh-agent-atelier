/** 面板首帧的工作空间范围推导；只读注入的 ScopeSource，不碰 React 或宿主。 */
import {
  deriveChoice,
  listStatusOf,
  readRemembered,
  snapshotScope,
  writeRemembered,
} from './workspace-scope.ts'

import type {
  DerivedChoice,
  ScopeNotice,
  ScopeSource,
} from './workspace-scope.ts'

/** 记住的工作空间已不存在：本次范围是被迫重选的，头部说明一次。 */
export const STALE_SCOPE_NOTICE: ScopeNotice = Object.freeze({
  severity: 'info',
  text: '上次的工作空间已不存在，已重新选择',
})

/** 首帧的范围推导：记忆的选择 → 当前会话 → 最近活跃 → 用户全局。 */
export function bootstrapScopeChoice(scope: ScopeSource): DerivedChoice {
  const snapshot = snapshotScope(scope)
  const derived = deriveChoice({
    items: snapshot.items,
    sessions: snapshot.sessions,
    remembered: readRemembered(scope.storage),
    // 列表还没就绪时 items 只是空占位，不能据此把记住的工作区判成失效。
    listsReady: listStatusOf(snapshot.list) === 'ready',
  })
  // 记住的工作区已经没了：把这次被迫重选的结果记下来，别每次打开都提示一遍。
  if (derived.staleRemembered !== undefined) writeRemembered(scope.storage, derived.choice)
  return derived
}
