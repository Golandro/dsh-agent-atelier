/**
 * 分栏布局（票 05，从 prototype/settings-ui/src/pane-layout.ts 与
 * components/PaneSplitter.tsx 移植）。
 *
 * 统一规则（与原型一致）：
 *   available = 容器宽度 − 排除项（如右侧抽屉；本页 Q2 最小口径暂无排除项）
 *   列表宽度在 [列表最小, available − 内容最小 − 分隔条] 之间夹取
 *   available < 列表最小 + 内容最小 + 分隔条 ⇒ 单栏模式（编辑器独占主视图，
 *     列表隐藏）——这是布局决策，由 styles.css 的 `@container pane` 接管；
 *     JS 只保留拖拽宽度的夹取，断点常量与 CSS 由测试校验同步。
 *
 * 与原型的偏差：拖拽中的 `is-resizing` 类不再挂 body，而是挂到最近的
 * `.agents-manager-page` 根元素上，让「拖拽时全局禁选」的样式留在插件作用域内，
 * 不污染宿主壳。
 */
import { createElement as h, useLayoutEffect, useState } from 'react'
import { PAGE_ROOT_CLASS, nsClass } from './class-names.ts'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'

/** 列表栏最小宽（rem）。 */
export const PANE_LIST_MIN_REM = 20
/** 右侧内容区最小宽（rem）。 */
export const PANE_CONTENT_MIN_REM = 40
/** 列表栏默认宽（rem）。 */
export const PANE_LIST_DEFAULT_REM = 24
/** 分隔条宽（rem）。 */
export const PANE_SPLITTER_REM = 0.375

export function rootFontSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

export interface PaneLayoutOptions {
  /** 从可用宽度中扣除的元素（如右侧顾问抽屉）；本页暂未使用。 */
  readonly excludeRef?: RefObject<HTMLElement | null>
  /** 排除项当前是否生效。 */
  readonly excludeActive?: boolean
  /** 容器挂载/切换标识；变化时重新测量并观察。 */
  readonly measureKey?: unknown
}

export interface PaneLayout {
  available: number
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
      const excluded = options.excludeActive === true && options.excludeRef?.current
        ? options.excludeRef.current.offsetWidth
        : 0
      setAvailable(Math.max(0, base - excluded))
    }
    update()
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    if (options.excludeActive === true && options.excludeRef?.current) ro.observe(options.excludeRef.current)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [containerRef, options.excludeRef, options.excludeActive, options.measureKey])

  const maxListWidth = Math.max(minList, available - minContent - splitter)
  const defaultListWidth = Math.min(maxListWidth, Math.max(minList, PANE_LIST_DEFAULT_REM * rem))

  // 视口/抽屉变化后把已保存的列表宽度夹回合法范围。
  useLayoutEffect(() => {
    setListWidth((w) => Math.min(maxListWidth, Math.max(minList, w)))
  }, [minList, maxListWidth])

  return {
    available,
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

export interface PaneSplitterProps {
  label: string
  /** 当前左栏宽度（受控）。 */
  value: number
  min: number
  max: number
  onResize: (width: number) => void
  onReset?: () => void
}

/**
 * 可拖拽分栏：只负责交互与无障碍语义，宽度状态、边界和落位由父级决定。
 * 指针拖拽按「按下时的宽度 + 位移」计算；键盘 ←/→ 步进 16px；双击复位。
 */
export function PaneSplitter(props: PaneSplitterProps): ReactNode {
  const { min, max } = props

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    // 拖拽态挂页面根而非 body：样式经 .agents-manager-page 作用域生效。
    const root = e.currentTarget.closest(`.${PAGE_ROOT_CLASS}`)
    const startX = e.clientX
    const startWidth = props.value
    const onMove = (ev: PointerEvent) => {
      props.onResize(Math.min(max, Math.max(min, startWidth + ev.clientX - startX)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      root?.classList.remove('is-resizing')
    }
    root?.classList.add('is-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return h('div', {
    className: nsClass('pane-splitter'),
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': props.label,
    'aria-valuemin': Math.round(min),
    'aria-valuemax': Math.round(max),
    'aria-valuenow': Math.round(props.value),
    tabIndex: 0,
    onPointerDown: startResize,
    onDoubleClick: props.onReset,
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        props.onResize(Math.max(min, props.value - 16))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        props.onResize(Math.min(max, props.value + 16))
      }
    },
  })
}
