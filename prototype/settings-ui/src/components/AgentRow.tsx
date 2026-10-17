/**
 * PROTOTYPE — 资源管理器「内容」视图行。
 *
 * 第 1 行：来源标签 · Agent 名称 · 弹性空白 · 路径 · 状态
 * 第 2 行：Agent 摘要 · 其他属性（模型链 / 工具 / 技能 / spawn / reasoning）
 *
 * 内容 = 两行全显；紧凑 = 只留第 1 行（视图级折叠，不做行内切换）。
 * 行是扁平的，不套卡片外壳；选中/悬停只改变行底色与左侧强调线。
 */
import type { AgentDoc } from '../types'
import { displayName, layerLabel, layerTag } from '../model'

export interface AgentRowProps {
  agent: AgentDoc
  selected: boolean
  errs: number
  hints: number
  expanded: boolean
  onSelect: () => void
}

export function AgentRow(props: AgentRowProps) {
  const a = props.agent
  const fm = a.frontmatter
  const tag = layerTag(a.source)
  const rawModel = (fm.model ?? []).map((m) => `${m.provider}/${m.model}`)
  const modelChain = fm.modelOrder?.length
    ? fm.modelOrder.join(' → ')
    : rawModel.length
      ? `raw ${rawModel.join(', ')}`
      : '无'
  const attrs = [
    `模型 ${modelChain}`,
    fm.requiredTools?.length ? `工具 ${fm.requiredTools.join(', ')}` : null,
    fm.skills?.length ? `技能 ${fm.skills.join(', ')}` : null,
    fm.spawn ? `spawn ${fm.spawn}` : null,
    fm.reasoningEffort ? `reasoning ${fm.reasoningEffort}` : null,
  ]
    .filter((v): v is string => Boolean(v))
    .join(' · ')
  const hasIssues = props.errs + props.hints > 0
  const desc = fm.description?.trim() || '（无描述）'
  const statusTitle = a.disabled
    ? `已禁用${hasIssues ? ` · ${props.errs} 个错误 · ${props.hints} 个提示` : ''}`
    : `${props.errs} 个错误 · ${props.hints} 个提示`

  return (
    <div
      className={`agent-row${props.selected ? ' selected' : ''}${props.expanded ? ' expanded' : ' collapsed'}${a.disabled ? ' disabled' : ''}`}
      data-agent={a.agentName}
      role="option"
      aria-selected={props.selected}
      aria-label={`${displayName(a)}，${layerLabel(a.source)}，${a.disabled ? '已禁用' : `${props.errs} 个错误 ${props.hints} 个提示`}`}
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onSelect()
        }
      }}
    >
      <div className="agent-row-primary">
        <span className={`agent-source-tag ${tag}`} title={layerLabel(a.source)}>{tag}</span>
        <span className="agent-row-name" title={`${displayName(a)} · ${a.agentName}`}>{displayName(a)}</span>
        <span className="agent-row-flex" />
        <span className="agent-row-path" title={a.path}>{a.path}</span>
        <span className="agent-row-status" title={statusTitle}>
          {a.disabled ? (
            <span className="agent-status-dot disabled" aria-label="已禁用" />
          ) : hasIssues ? (
            <span className={`agent-badge ${props.errs > 0 ? 'err' : 'warn'}`}>
              {props.errs > 0 ? `${props.errs}E` : ''}{props.hints > 0 ? `${props.hints}H` : ''}
            </span>
          ) : (
            <span className="agent-status-dot ok" aria-label="无诊断" />
          )}
        </span>
      </div>

      {props.expanded && (
        <div className="agent-row-secondary">
          <span className={`agent-row-desc${fm.description?.trim() ? '' : ' empty'}`} title={fm.description || undefined}>{desc}</span>
          {attrs && <span className="agent-row-attrs" title={attrs}>{attrs}</span>}
        </div>
      )}
    </div>
  )
}
