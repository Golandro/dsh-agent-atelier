/**
 * PROTOTYPE — 分栏布局策略（Agents / Prompt Sections 共用）。
 *
 * 统一规则（两个主从视图只在右侧内容形态上不同：编辑器 vs 只读详情）：
 *   available = 容器宽度 − 排除项（如右侧顾问抽屉）
 *   列表宽度在 [列表最小, available − 内容最小 − 分隔条] 之间夹取
 *   available < 列表最小 + 内容最小 + 分隔条 ⇒ 浮层模式（内容区盖住列表）
 */
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export const PANE_LIST_MIN_REM = 20
export const PANE_CONTENT_MIN_REM = 40
export const PANE_LIST_DEFAULT_REM = 24
export const PANE_SPLITTER_REM = 0.375

export function rootFontSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/** 并列所需的最小宽度；小于它时右侧内容改为浮层。 */
export function paneSplitThreshold(): number {
  return (PANE_LIST_MIN_REM + PANE_CONTENT_MIN_REM + PANE_SPLITTER_REM) * rootFontSize()
}

export interface PaneLayoutOptions {
  /** 从可用宽度中扣除的元素（如右侧顾问抽屉） */
  excludeRef?: RefObject<HTMLElement | null>
  /** 排除项当前是否生效 */
  excludeActive?: boolean
  /** 容器挂载/切换标识（如活动页签）；变化时重新测量并观察 */
  measureKey?: unknown
}

export interface PaneLayout {
  available: number
  overlay: boolean
  minList: number
  minContent: number
  splitter: number
  listWidth: number
  maxListWidth: number
  defaultListWidth: number
  setListWidth: (width: number) => void
  resetListWidth: () => void
}

export function usePaneLayout<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: PaneLayoutOptions = {},
): PaneLayout {
  const rem = rootFontSize()
  const minList = PANE_LIST_MIN_REM * rem
  const minContent = PANE_CONTENT_MIN_REM * rem
  const splitter = PANE_SPLITTER_REM * rem

  const [available, setAvailable] = useState(() => window.innerWidth)
  const [listWidth, setListWidth] = useState(() => {
    const max = Math.max(minList, window.innerWidth - minContent - splitter)
    return Math.min(max, Math.max(minList, PANE_LIST_DEFAULT_REM * rem))
  })

  useLayoutEffect(() => {
    const update = () => {
      const base = containerRef.current?.clientWidth ?? window.innerWidth
      const excluded = options.excludeActive && options.excludeRef?.current
        ? options.excludeRef.current.offsetWidth
        : 0
      setAvailable(Math.max(0, base - excluded))
    }
    update()
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    if (options.excludeActive && options.excludeRef?.current) ro.observe(options.excludeRef.current)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [containerRef, options.excludeRef, options.excludeActive, options.measureKey])

  const overlay = available < minList + minContent + splitter
  const maxListWidth = Math.max(minList, available - minContent - splitter)
  const defaultListWidth = Math.min(maxListWidth, Math.max(minList, PANE_LIST_DEFAULT_REM * rem))

  // 视口/抽屉变化后把已保存的列表宽度夹回合法范围。
  useLayoutEffect(() => {
    setListWidth((w) => Math.min(maxListWidth, Math.max(minList, w)))
  }, [minList, maxListWidth])

  return {
    available,
    overlay,
    minList,
    minContent,
    splitter,
    listWidth,
    maxListWidth,
    defaultListWidth,
    setListWidth,
    resetListWidth: () => setListWidth(defaultListWidth),
  }
}
