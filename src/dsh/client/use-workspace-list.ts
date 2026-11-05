/**
 * 工作区列表的订阅面（票 37）：挂载时读一次宿主快照，之后跟着两个订阅刷新。
 *
 * 服务缺失或形状不对时 status = `unavailable`，面板照常工作（用户全局）；
 * 订阅失败也只是退化成「打开面板时读一次」，不抛错、不阻断渲染。
 */
import { useEffect, useState } from 'react'

import { listStatusOf, snapshotScope } from './workspace-scope.ts'

import type { ScopeListStatus, ScopeSource, WorkspaceRow } from './workspace-scope.ts'

/** 选择器需要的一行数据：可用行 + 列表状态。 */
export interface WorkspaceListState {
  readonly rows: readonly WorkspaceRow[]
  readonly status: ScopeListStatus
}

/** 读一次列表（导出给壳在 bootstrap 时复用，避免两次口径）。 */
export function readWorkspaceList(source: ScopeSource | undefined): WorkspaceListState {
  const { items, list } = snapshotScope(source)
  return { rows: items, status: listStatusOf(list) }
}

/** 订阅宿主列表；只在 source 变化时重建订阅。 */
export function useWorkspaceList(source: ScopeSource | undefined): WorkspaceListState {
  const [state, setState] = useState<WorkspaceListState>(() => readWorkspaceList(source))

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      if (!cancelled) setState(readWorkspaceList(source))
    }
    // 服务可能在挂载后才就绪：先读一次，再挂订阅（pending → ready 会推一次）。
    refresh()
    const offs: Array<() => void> = []
    for (const read of [() => source?.readWorkspaces(), () => source?.readSessions()]) {
      let snapshot: { subscribe(listener: () => void): () => void } | undefined
      try {
        snapshot = read()
      } catch {
        snapshot = undefined
      }
      if (snapshot === undefined) continue
      try {
        offs.push(snapshot.subscribe(refresh))
      } catch {
        // 订阅失败不是致命错误：退化成打开面板时读一次。
      }
    }
    return () => {
      cancelled = true
      for (const off of offs) {
        try {
          off()
        } catch {
          // 服务已卸载：忽略。
        }
      }
    }
  }, [source])

  return state
}
