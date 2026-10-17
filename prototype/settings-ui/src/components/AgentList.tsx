/**
 * PROTOTYPE — Agent 列表（P1 A 区）：同时支持「详情」与「半卡片」两种视图。
 * - 详情 = AgentDetail：扁平、双列 label/value，不是卡片外壳。
 * - 半卡片 = AgentCard：详情折叠后的形态，保留自己的边框约束内容。
 * 头部切换视图；单项也可用 ▸/▾ 独立展开/折叠（半卡片 = 详情的折叠态）。
 * 窄屏时变为横向滑动条（app.css 响应式）。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { AgentDoc, Finding } from '../types'
import { AgentCard } from './AgentCard'
import { AgentDetail } from './AgentDetail'

export interface AgentListProps {
  agents: AgentDoc[]
  findings: Finding[]
  selected: string
  onSelect: (agentName: string) => void
}

type ViewMode = 'detail' | 'compact'

export function AgentList(props: AgentListProps) {
  const [mode, setMode] = useState<ViewMode>('detail')
  /** 单项覆盖：true = 展开为详情，false = 折叠为半卡片；缺省跟随 mode */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const listRef = useRef<HTMLElement>(null)
  const isOpen = (name: string) => overrides[name] ?? mode === 'detail'
  const switchMode = (next: ViewMode) => {
    setMode(next)
    setOverrides({})
  }

  // 视图切换会让行高整体变化；在布局提交后立刻把选中项拉回可视区。
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-agent]')
    const el = nodes ? Array.from(nodes).find((n) => n.dataset.agent === props.selected) : undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [mode, props.selected])

  return (
    <aside ref={listRef} className={`agent-list ${mode === 'detail' ? 'detail-mode' : 'cards-mode'}`}>
      <div className="agent-list-head">
        <div className="agent-list-title">Agent List</div>
        <div className="agent-view-toggle" role="group" aria-label="Agent 列表视图">
          <button
            type="button"
            className={mode === 'detail' ? 'active' : ''}
            aria-pressed={mode === 'detail'}
            onClick={() => switchMode('detail')}
          >详情</button>
          <button
            type="button"
            className={mode === 'compact' ? 'active' : ''}
            aria-pressed={mode === 'compact'}
            onClick={() => switchMode('compact')}
          >半卡片</button>
        </div>
      </div>

      {props.agents.map((a) => {
        const errs = props.findings.filter((f) => f.agentName === a.agentName && f.severity === 'error').length
        const hints = props.findings.filter((f) => f.agentName === a.agentName && f.severity === 'hint').length
        const common = {
          agent: a,
          selected: props.selected === a.agentName,
          errs,
          hints,
          onSelect: () => props.onSelect(a.agentName),
        }
        return isOpen(a.agentName) ? (
          <AgentDetail
            key={a.agentName}
            {...common}
            onCollapse={() => setOverrides((o) => ({ ...o, [a.agentName]: false }))}
          />
        ) : (
          <AgentCard
            key={a.agentName}
            {...common}
            onExpand={() => setOverrides((o) => ({ ...o, [a.agentName]: true }))}
          />
        )
      })}
    </aside>
  )
}
