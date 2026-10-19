/**
 * PROTOTYPE — 内容视图：资源管理器「内容」排布的两行全显态。
 * 行内不再提供折叠按钮；展开/紧凑由列表头的视图切换决定。
 */
import type { AgentDoc } from '../types'
import { AgentRow } from './AgentRow'

export interface AgentDetailProps {
  agent: AgentDoc
  selected: boolean
  errs: number
  hints: number
  onSelect: () => void
}

export function AgentDetail(props: AgentDetailProps) {
  return <AgentRow {...props} expanded />
}
