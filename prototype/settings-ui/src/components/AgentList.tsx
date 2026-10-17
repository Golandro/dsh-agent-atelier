/**
 * PROTOTYPE — Agent 列表（P1 A 区）：卡片 + 层标签（user/workspace/bundled）+ 诊断徽标。
 * 窄屏时变为横向滑动卡片条（app.css 响应式）。
 */
import type { AgentDoc, Finding } from '../types'
import { layerLabel, layerTag } from '../model'

export interface AgentListProps {
  agents: AgentDoc[]
  findings: Finding[]
  selected: string
  onSelect: (agentName: string) => void
}

export function AgentList(props: AgentListProps) {
  return (
    <aside className="agent-list">
      <div className="agent-list-title">Agent List</div>
      {props.agents.map((a) => {
        const errs = props.findings.filter((f) => f.agentName === a.agentName && f.severity === 'error').length
        const hints = props.findings.filter((f) => f.agentName === a.agentName && f.severity === 'hint').length
        const tag = layerTag(a.source)
        return (
          <div
            key={a.agentName}
            className={`agent-card${props.selected === a.agentName ? ' selected' : ''}`}
            onClick={() => props.onSelect(a.agentName)}
          >
            <div className="agent-card-head">
              <span className="agent-avatar" style={a.frontmatter.color ? { background: a.frontmatter.color } : undefined}>
                {a.frontmatter.emoji ?? a.agentName[0]}
              </span>
              <span className="agent-name">{a.frontmatter.name ?? a.agentName}</span>
              {(errs > 0 || hints > 0) && (
                <span className={`agent-badge ${errs > 0 ? 'err' : 'warn'}`} title="诊断数（详见顾问面板）">
                  {errs > 0 ? `${errs}E` : ''}{hints > 0 ? `${hints}H` : ''}
                </span>
              )}
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
      })}
    </aside>
  )
}
