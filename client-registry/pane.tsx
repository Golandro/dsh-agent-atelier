/**
 * 分栏布局（registry chunk 私有件，票 63）。
 *
 * 与主 bundle `src/dsh/client/pane.tsx` 同构、常量同口径（20rem / 40rem /
 * 0.375rem / 默认 24rem）：发布 chunk 不能 import 主 bundle 源码（import 矩阵
 * 只放行 control 公共入口与 chunk-contracts），所以这里是与 client-list 的
 * ListPane 相同的刻意重复；test/pane-layout-css.test.ts 断言两套常量相等，
 * 防止漂移。
 *
 * 与主 bundle 版本的差异只有两处：
 * 1. 初始尺寸对 SSR 安全（没有 window / document 时用 1280px / 16px 占位，
 *    静态渲染后再由 layout effect 按真实容器测量）；
 * 2. 类名直接写 `pane-splitter` / `agent-atelier-page`，不 import 主 bundle
 *    的 class-names.ts。
 *
 * 大块布局（双栏 ↔ 单栏）仍由主 bundle 的 styles.css `@container pane` 决定，
 * 本文件只负责拖拽宽度夹取与无障碍语义。
 */
import { createElement as h, useLayoutEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'

/** 列表栏最小宽（rem）；与主 bundle pane.tsx 一致。 */
export const PANE_LIST_MIN_REM = 20
/** 右侧内容区最小宽（rem）；与主 bundle pane.tsx 一致。 */
export const PANE_CONTENT_MIN_REM = 40
/** 列表栏默认宽（rem）；与主 bundle pane.tsx 一致。 */
export const PANE_LIST_DEFAULT_REM = 24
/** 分隔条宽（rem）；与主 bundle pane.tsx 一致。 */
export const PANE_SPLITTER_REM = 0.375

/** 分隔条类名（主 bundle 的 nsClass('pane-splitter') 里的局部类）。 */
const SPLITTER_CLASS = 'pane-splitter'

export function rootFontSize(): number {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return 16
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

export interface PaneLayoutOptions {
  /** 从可用宽度中扣除的元素（如右侧顾问抽屉）。 */
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

  const [available, setAvailable] = useState(viewportWidth)
  const [listWidth, setListWidth] = useState(() => {
    const viewport = viewportWidth()
    const max = Math.max(minList, viewport - minContent - splitter)
    return Math.min(max, Math.max(minList, PANE_LIST_DEFAULT_REM * rem))
  })

  useLayoutEffect(() => {
    const update = () => {
      const base = containerRef.current?.clientWidth ?? viewportWidth()
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

  // 视口/容器变化后把已保存的列表宽度夹回合法范围。
  useLayoutEffect(() => {
    setListWidth((width) => Math.min(maxListWidth, Math.max(minList, width)))
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

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // 拖拽态挂页面根而非 body：样式经 .agent-atelier-page 作用域生效。
    const root = event.currentTarget.closest('.agent-atelier-page')
    const startX = event.clientX
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
    className: SPLITTER_CLASS,
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': props.label,
    'aria-valuemin': Math.round(min),
    'aria-valuemax': Math.round(max),
    'aria-valuenow': Math.round(props.value),
    tabIndex: 0,
    onPointerDown: startResize,
    onDoubleClick: props.onReset,
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        props.onResize(Math.max(min, props.value - 16))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        props.onResize(Math.min(max, props.value + 16))
      }
    },
  })
}
