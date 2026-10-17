/**
 * PROTOTYPE — System Prompts 页：
 * 左列 = per-model 系统提示词（D6：调优层挂真实模型条目，与 persona 分层）；
 * 右列 = 别名 → 模型条目映射（S5：改目标 = 注入名不变、内容瞬时换；dsh-default 只读）。
 * 窄屏两列堆叠（app.css 响应式）。
 */
import { useState } from 'react'
import type { AgentDoc, AliasDef, ModelDef } from '../types'
import { layerLabel } from '../model'

export interface SystemPromptsProps {
  models: ModelDef[]
  aliases: AliasDef[]
  agents: AgentDoc[]
  onToggleAvailable: (modelName: string) => void
  onSaveSysPrompt: (modelName: string, text: string) => void
  onRemap: (alias: string, target: string) => void
}

function ModelCard(props: { model: ModelDef; onToggleAvailable: (n: string) => void; onSaveSysPrompt: (n: string, t: string) => void }) {
  const m = props.model
  const [draft, setDraft] = useState(m.sysPrompt ?? '')
  const dirty = draft !== (m.sysPrompt ?? '')
  return (
    <div className={`card model-card${m.available ? '' : ' off'}`}>
      <div className="model-head">
        <span className="model-name">{m.modelName}</span>
        <span className={`tag tag-${m.source.startsWith('project') ? 'workspace' : m.source === 'bundled' ? 'bundled' : 'user'}`}>{layerLabel(m.source)}</span>
        {m.synthesized && <span className="tag" title="合成条目">synthesized</span>}
        <span className="editor-spacer" />
        <label className="toggle" title="available:false = 解析时跳过（沿声明顺序回退；Q1 裁决：v1 手动开关）">
          <input type="checkbox" checked={m.available} onChange={() => props.onToggleAvailable(m.modelName)} />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="model-id">{m.provider}/{m.model}</div>
      <textarea
        className="input sys-area"
        rows={3}
        value={draft}
        placeholder="（无 sysPrompt —— 未调优）"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="model-foot">
        <span className="dim">{m.path}</span>
        <button className="btn btn-sm" disabled={!dirty} onClick={() => props.onSaveSysPrompt(m.modelName, draft)}>保存</button>
      </div>
    </div>
  )
}

export function SystemPrompts(props: SystemPromptsProps) {
  const modelNames = props.models.map((m) => m.modelName)
  const hitOf = (target: string | undefined) => props.models.find((m) => m.modelName === target)
  const userAliases = props.aliases.filter((a) => !a.builtin)
  const builtin = props.aliases.filter((a) => a.builtin)

  return (
    <div className="prompts-page">
      <div className="page-head">
        <h2>System Prompts</h2>
        <p className="page-sub">
          per-model 提示词挂真实模型条目（D6），与 agent persona 分层；别名改目标 = 注入名不变、内容瞬时换（S5）。
        </p>
      </div>
      <div className="prompts-grid">
        <section>
          <h3 className="col-title">模型条目</h3>
          {props.models.map((m) => (
            <ModelCard key={m.modelName} model={m} onToggleAvailable={props.onToggleAvailable} onSaveSysPrompt={props.onSaveSysPrompt} />
          ))}
        </section>
        <section>
          <h3 className="col-title">别名</h3>
          {userAliases.map((a) => {
            const hit = hitOf(a.targets[0])
            const usedBy = props.agents.filter((ag) => (ag.frontmatter.modelOrder ?? []).includes(a.alias)).map((ag) => ag.agentName)
            return (
              <div className="card alias-card" key={a.alias}>
                <div className="alias-head">
                  <span className="alias-name">{a.alias}</span>
                  <span className={`tag tag-${a.source.startsWith('project') ? 'workspace' : 'user'}`}>{layerLabel(a.source)}</span>
                  <span className="editor-spacer" />
                  <select
                    className="select"
                    value={a.targets[0] ?? ''}
                    onChange={(e) => props.onRemap(a.alias, e.target.value)}
                    title="改目标 = S5 重映射（注入名不变）"
                  >
                    {!hit && <option value={a.targets[0]}>{a.targets[0]}（不存在）</option>}
                    {modelNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="alias-hit">
                  {hit ? <>→ {hit.provider}/{hit.model}{hit.available ? '' : '（available:false，解析时跳过）'}</> : <span className="err-text">→ 目标不存在（unknown-model-target）</span>}
                </div>
                <div className="alias-refs dim">{usedBy.length > 0 ? `使用者：${usedBy.join('、')}` : '无人使用'}</div>
              </div>
            )
          })}
          {builtin.map((a) => {
            const hit = hitOf(a.targets[0])
            return (
              <div className="card alias-card builtin" key={a.alias}>
                <div className="alias-head">
                  <span className="alias-name">{a.alias}</span>
                  <span className="tag tag-bundled">内置指针 · 只读</span>
                </div>
                <div className="alias-hit">→ {hit ? `${hit.provider}/${hit.model}` : a.targets[0]}</div>
                <div className="alias-refs dim">装载时快照自 DSH 子代理默认对；invalidate 重读（D4）。用户别名永远写不进 DSH 的设置面板。</div>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
