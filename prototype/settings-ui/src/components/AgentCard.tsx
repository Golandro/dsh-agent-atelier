/**
 * PROTOTYPE — 紧凑行：内容视图的折叠态（只保留第 1 行）。
 * 不再使用卡片外壳；行内无展开按钮，由列表头的视图切换统一控制。
 */
import type { AgentDoc } from '../types'
import { AgentRow } from './AgentRow'

export interface AgentCardProps {
  agent: AgentDoc
  selected: boolean
  errs: number
  hints: number
  onSelect: () => void
}

export function AgentCard(props: AgentCardProps) {
  return <AgentRow {...props} expanded={false} />
}
