/**
 * PROTOTYPE — 可拖拽分栏（共用控件）。
 *
 * 只负责交互与无障碍语义：宽度状态、边界和落位由父级决定。
 * 指针拖拽按「按下时的宽度 + 位移」计算；键盘 ←/→ 步进 16px；双击复位。
 */
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface PaneSplitterProps {
  label: string
  /** 当前左栏宽度（受控） */
  value: number
  min: number
  max: number
  onResize: (width: number) => void
  onReset?: () => void
  className?: string
}

export function PaneSplitter(props: PaneSplitterProps) {
  const { min, max } = props

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = props.value
    const onMove = (ev: PointerEvent) => {
      props.onResize(Math.min(max, Math.max(min, startWidth + ev.clientX - startX)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('is-resizing')
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <div
      className={`pane-splitter${props.className ? ` ${props.className}` : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(props.value)}
      tabIndex={0}
      onPointerDown={startResize}
      onDoubleClick={props.onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          props.onResize(Math.max(min, props.value - 16))
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          props.onResize(Math.min(max, props.value + 16))
        }
      }}
    />
  )
}
