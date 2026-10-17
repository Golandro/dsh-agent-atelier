/**
 * PROTOTYPE — 系统提示词页：per-model sysPrompt 调优（D6）。
 *
 * 模型条目身份、available 开关、别名映射与层覆盖已统一到「模型关联」页；
 * 本页只负责提示词内容，避免两处都能改注册表。列表按层解析后每个模型名只出现一次
 * （工作区胜），被遮蔽条目在模型关联页查看。
 */
import { useEffect, useState } from 'react'
import type { AgentSource, AliasDef, ModelDef } from '../types'
import { aliasesPointingAt, layerLabel, layerTag, modelKey, resolveModel } from '../model'

export interface SystemPromptsProps {
  models: ModelDef[]
  aliases: AliasDef[]
  onSaveSysPrompt: (source: AgentSource, modelName: string, text: string) => void
  onOpenRegistry: () => void
  /** 从模型关联页跳转过来时要滚动并高亮的模型名 */
  focusModelName?: string | null
  onFocusConsumed?: () => void
}

function ModelCard(props: {
  model: ModelDef
  aliasCount: number
  focused: boolean
  onSave: (source: AgentSource, modelName: string, text: string) => void
}) {
  const m = props.model
  const [draft, setDraft] = useState(m.sysPrompt ?? '')
  const dirty = draft !== (m.sysPrompt ?? '')

  // 模型条目内容变化（保存/回退/外部失效）时同步草稿基线。
  useEffect(() => setDraft(m.sysPrompt ?? ''), [m.sysPrompt])

  return (
    <div
      className={`card model-card${m.available ? '' : ' off'}${props.focused ? ' focus' : ''}`}
      data-model-name={m.modelName}
    >
      <div className="model-head">
        <span className="model-name">{m.modelName}</span>
        <span className={`tag tag-${layerTag(m.source)}`}>{layerLabel(m.source)}</span>
        {m.synthesized && <span className="tag" title="合成条目">synthesized</span>}
        <span className="model-head-fill" />
        {m.available
          ? <span className="tag tag-ok">可用</span>
          : <span className="tag tag-warn" title="在「模型关联」页切换 available">停用 · 解析时跳过</span>}
      </div>
      <div className="model-id">{m.provider}/{m.model}</div>
      <textarea
        className="input sys-area"
        rows={3}
        value={draft}
        aria-label={`${m.modelName} 的 sysPrompt`}
        placeholder="（无 sysPrompt —— 未调优）"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="model-foot">
        <span className="model-foot-meta">
          <span className="dim model-foot-path" title={m.path}>{m.path ?? '—'}</span>
          <span className="dim">{props.aliasCount > 0 ? `别名 ×${props.aliasCount}` : '无别名指向'}</span>
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!dirty}
          aria-label={`保存 ${m.modelName} 的 sysPrompt`}
          onClick={() => props.onSave(m.source, m.modelName, draft)}
        >保存</button>
      </div>
    </div>
  )
}

export function SystemPrompts(props: SystemPromptsProps) {
  const [focusedName, setFocusedName] = useState<string | null>(null)
  const { focusModelName, onFocusConsumed } = props

  // 每个模型名只展示生效层；排序稳定，便于跨页跳转定位。
  const models = [...new Set(props.models.map((m) => m.modelName))]
    .flatMap((name) => resolveModel(name, props.models) ?? [])
    .sort((a, b) => a.modelName.localeCompare(b.modelName, 'zh-CN'))

  useEffect(() => {
    if (!focusModelName) return
    setFocusedName(focusModelName)
    const el = window.document.querySelector<HTMLElement>(
      `[data-model-name="${CSS.escape(focusModelName)}"]`,
    )
    el?.scrollIntoView({ block: 'center' })
    onFocusConsumed?.()
    // 不随 focusModelName 清空而清理定时器：消费焦点会立刻把 prop 置空，
    // 若在这里 cleanup，高亮就永远不会退场。
    window.setTimeout(() => setFocusedName(null), 1800)
  }, [focusModelName, onFocusConsumed])

  return (
    <div className="prompts-page">
      <div className="page-head">
        <h2>系统提示词</h2>
        <button type="button" className="btn btn-sm" onClick={props.onOpenRegistry}>模型关联 →</button>
        <p className="page-sub">
          per-model 提示词挂在真实模型条目上（D6），与 agent persona 分层。模型集合、available 与别名映射在「模型关联」页统一管理；
          被工作区覆盖的低层条目不会出现在这里。
        </p>
      </div>
      <div className="prompts-grid">
        {models.map((m) => (
          <ModelCard
            key={modelKey(m)}
            model={m}
            aliasCount={aliasesPointingAt(m.modelName, props.aliases).length}
            focused={focusedName === m.modelName}
            onSave={props.onSaveSysPrompt}
          />
        ))}
      </div>
      <div className="prompts-note dim">
        共 {models.length} 个生效模型条目（按层解析后）；调优只写入该条目所在的 registry.yaml。
      </div>
    </div>
  )
}
