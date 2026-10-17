/**
 * PROTOTYPE — 详情：双行布局。
 * 第 1 行 = 身份 / 摘要（头像、名称、层与模型、诊断、折叠）；
 * 第 2 行 = 字段网格（label 上、value 下，按可用宽度自动换列）。
 * 半卡片 = 本组件的折叠态；两者是独立组件。
 */
import type { ReactNode } from 'react'
import type { AgentDoc } from '../types'
import { layerLabel } from '../model'

export interface AgentDetailProps {
  agent: AgentDoc
  selected: boolean
  errs: number
  hints: number
  onSelect: () => void
  onCollapse: () => void
}

function Field(props: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }) {
  return (
    <div className={`detail-field${props.wide ? ' wide' : ''}`}>
      <dt>{props.label}</dt>
      <dd className={props.mono ? 'mono' : undefined}>{props.value}</dd>
    </div>
  )
}

export function AgentDetail(props: AgentDetailProps) {
  const a = props.agent
  const fm = a.frontmatter
  const rawModel = (fm.model ?? []).map((m) => `${m.provider}/${m.model}`)
  const extras = Object.entries(a.extra)
  const modelSummary = fm.modelOrder?.length
    ? fm.modelOrder.join(' · ')
    : rawModel.length
      ? `raw · ${rawModel.join(', ')}`
      : '无模型链'

  return (
    <section
      className={`agent-detail${props.selected ? ' selected' : ''}`}
      data-agent={a.agentName}
      onClick={props.onSelect}
    >
      {/* 第 1 行：身份 / 摘要 */}
      <div className="agent-detail-head">
        <span className="agent-avatar" style={fm.color ? { background: fm.color } : undefined}>
          {fm.emoji ?? a.agentName[0]}
        </span>
        <div className="agent-detail-id">
          <span className="agent-name">{fm.name ?? a.agentName}</span>
          <span className="agent-detail-meta" title={`${layerLabel(a.source)} · ${modelSummary}`}>
            {layerLabel(a.source)} · {modelSummary}
          </span>
        </div>
        {(props.errs > 0 || props.hints > 0) && (
          <span className={`agent-badge ${props.errs > 0 ? 'err' : 'warn'}`} title="诊断数（详见顾问面板）">
            {props.errs > 0 ? `${props.errs}E` : ''}{props.hints > 0 ? `${props.hints}H` : ''}
          </span>
        )}
        <button
          type="button"
          className="agent-expand"
          title="折叠为半卡片"
          aria-label="折叠为半卡片"
          onClick={(e) => { e.stopPropagation(); props.onCollapse() }}
        >▾</button>
      </div>

      {/* 第 2 行：字段网格 */}
      <dl className="agent-detail-fields">
        <Field label="描述" value={fm.description || '—'} wide />
        <Field label="来源" value={a.source} mono />
        <Field label="Agent 名" value={a.agentName} mono />
        <Field label="层级" value={layerLabel(a.source)} />
        <Field label="模型链" value={fm.modelOrder?.length ? fm.modelOrder.join(' · ') : '—'} mono />
        <Field label="raw model" value={rawModel.length ? rawModel.join(', ') : '—'} mono />
        <Field label="工具" value={fm.requiredTools?.length ? fm.requiredTools.join(', ') : '—'} mono />
        <Field label="技能" value={fm.skills?.length ? fm.skills.join(', ') : '—'} mono />
        <Field label="spawn" value={fm.spawn ?? '—'} mono />
        <Field label="reasoning" value={fm.reasoningEffort ?? '—'} mono />
        {extras.length > 0 && (
          <Field label="未知键" value={extras.map(([k, v]) => `${k}: ${v}`).join('；')} mono wide />
        )}
        <Field label="路径" value={a.path} mono wide />
      </dl>
    </section>
  )
}
