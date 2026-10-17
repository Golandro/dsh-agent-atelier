/**
 * PROTOTYPE — 半卡片：AgentDetail 的折叠态。
 * 与 AgentDetail 是两个独立组件：卡片有自己的边框约束内容，详情是扁平双列字段，不共用卡片外壳。
 */
import type { AgentDoc } from '../types'
import { layerLabel, layerTag } from '../model'

export interface AgentCardProps {
  agent: AgentDoc
  selected: boolean
  errs: number
  hints: number
  onSelect: () => void
  onExpand: () => void
}

export function AgentCard(props: AgentCardProps) {
  const a = props.agent
  const tag = layerTag(a.source)
  return (
    <div
      className={`agent-card${props.selected ? ' selected' : ''}`}
      data-agent={a.agentName}
      onClick={props.onSelect}
    >
      <div className="agent-card-head">
        <span className="agent-avatar" style={a.frontmatter.color ? { background: a.frontmatter.color } : undefined}>
          {a.frontmatter.emoji ?? a.agentName[0]}
        </span>
        <span className="agent-name">{a.frontmatter.name ?? a.agentName}</span>
        {(props.errs > 0 || props.hints > 0) && (
          <span className={`agent-badge ${props.errs > 0 ? 'err' : 'warn'}`} title="诊断数（详见顾问面板）">
            {props.errs > 0 ? `${props.errs}E` : ''}{props.hints > 0 ? `${props.hints}H` : ''}
          </span>
        )}
        <button
          type="button"
          className="agent-expand"
          title="展开为详情"
          aria-label="展开为详情"
          onClick={(e) => { e.stopPropagation(); props.onExpand() }}
        >▸</button>
      </div>
      <div className="agent-desc">{a.frontmatter.description || <span className="dim">（无 description）</span>}</div>
      <div className="agent-tags">
        <span className={`tag tag-${tag}`}>{layerLabel(a.source)}</span>
        <span className="tag">{a.agentName}</span>
        {(a.frontmatter.modelOrder ?? []).map((m) => (
          <span key={m} className="tag tag-accent">{m}</span>
        ))}
        {(a.frontmatter.model ?? []).length > 0 && <span className="tag tag-warn">raw model</span>}
      </div>
    </div>
  )
}
