/**
 * PROTOTYPE — 顾问面板（Q2 裁决的最小口径）：
 * ① 校验发现（02 findings + 05 警告项）② §6 通道表 + 断点推演（静态表驱动）
 * ③ S5 别名重映射即时影响预览 ④ fork 断点知识库 ⑤ 顺序反模式。
 * 诊断非阻挡：发现是解读与建议，不是门禁（D14/§8）。
 */
import { useState } from 'react'
import type { AgentDoc, AliasDef, ChannelRow, Finding, ModelDef } from '../types'
import { BREAK_LABEL, remapImpact, resolveAlias, resolveChain, resolveModel } from '../model'

export interface AdvisorPanelProps {
  findings: Finding[]
  agents: AgentDoc[]
  models: ModelDef[]
  aliases: AliasDef[]
  channelRows: ChannelRow[]
  selectedAgent: string
  onSelectAgent: (agentName: string) => void
  onRemap: (alias: string, target: string) => void
}

type SwitchKind = 'agent' | 'model'

export function AdvisorPanel(props: AdvisorPanelProps) {
  const errs = props.findings.filter((f) => f.severity === 'error')
  const hints = props.findings.filter((f) => f.severity === 'hint')

  const [switchKind, setSwitchKind] = useState<SwitchKind>('agent')
  const agent = props.agents.find((a) => a.agentName === props.selectedAgent) ?? props.agents[0]!
  const chain = resolveChain(agent, props.aliases, props.models)

  const userAliases = [...new Set(props.aliases.filter((a) => !a.builtin).map((a) => a.alias))]
    .flatMap((name) => resolveAlias(name, props.aliases) ?? [])
  const modelOptions = [...new Set(props.models.map((m) => m.modelName))]
    .flatMap((name) => resolveModel(name, props.models) ?? [])
  const [remapAlias, setRemapAlias] = useState(userAliases[0]?.alias ?? '')
  const aliasDef = userAliases.find((a) => a.alias === remapAlias)
  const [remapTarget, setRemapTarget] = useState(aliasDef?.targets[0] ?? '')
  const impact = remapAlias && remapTarget ? remapImpact(remapAlias, remapTarget, props.agents, props.models, props.aliases) : null

  return (
    <div className="advisor">
      <h3 className="advisor-title">顾问面板 <span className="dim">（诊断非阻挡 · 建议不是门禁）</span></h3>

      <section className="advisor-sec">
        <h4>校验发现 <span className="dim">{errs.length} error / {hints.length} hint</span></h4>
        {props.findings.length === 0 && <div className="dim">无发现。</div>}
        {props.findings.map((f, i) => (
          <div key={i} className={`finding ${f.severity}`}>
            <span className={`tag ${f.severity === 'error' ? 'tag-err' : 'tag-warn'}`}>{f.code}</span>
            <span className="finding-msg">{f.message}</span>
            {f.agentName && (
              <button className="btn btn-sm" onClick={() => props.onSelectAgent(f.agentName!)}>打开</button>
            )}
          </div>
        ))}
      </section>

      <section className="advisor-sec">
        <h4>缓存断点推演 <span className="dim">（spec §6 通道表，静态）</span></h4>
        <div className="bp-controls">
          <span className="dim">当前</span>
          <select className="select" value={agent.agentName} onChange={(e) => props.onSelectAgent(e.target.value)}>
            {props.agents.map((a) => <option key={a.agentName} value={a.agentName}>{a.agentName}</option>)}
          </select>
          <span className="dim">命中 {chain.hit ? `${chain.hit.provider}/${chain.hit.model}` : '—'}</span>
          <span className="editor-spacer" />
          <button className={`btn btn-sm${switchKind === 'agent' ? ' btn-primary' : ''}`} onClick={() => setSwitchKind('agent')}>切 Agent</button>
          <button className={`btn btn-sm${switchKind === 'model' ? ' btn-primary' : ''}`} onClick={() => setSwitchKind('model')}>切模型</button>
        </div>
        <table className="channel-table">
          <thead>
            <tr><th>内容</th><th>通道</th><th>机制</th><th>断点</th></tr>
          </thead>
          <tbody>
            {props.channelRows.map((r, i) => {
              const broken = r.breakOn === switchKind
              return (
                <tr key={i} className={broken ? 'bp' : ''}>
                  <td>{r.content}{broken && <span className="bp-mark" title={BREAK_LABEL[r.breakOn]}>⚡</span>}</td>
                  <td className="dim">{r.channel}</td>
                  <td className="dim">{r.mechanism}</td>
                  <td className="dim">{BREAK_LABEL[r.breakOn]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="dim advisor-note">推荐别名顺序 = 最可能的断点最晚（D10）。例：smart→fast 把换档断点推到 persona 之后尽可能晚的位置。</p>
      </section>

      <section className="advisor-sec">
        <h4>S5 别名重映射 · 即时影响预览</h4>
        <div className="bp-controls">
          <select className="select" value={remapAlias} onChange={(e) => { setRemapAlias(e.target.value); const d = userAliases.find((a) => a.alias === e.target.value); setRemapTarget(d?.targets[0] ?? '') }}>
            {userAliases.map((a) => <option key={a.alias} value={a.alias}>{a.alias}</option>)}
          </select>
          <span className="dim">→</span>
          <select className="select" value={remapTarget} onChange={(e) => setRemapTarget(e.target.value)}>
            {modelOptions.map((m) => <option key={m.modelName} value={m.modelName}>{m.modelName}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" disabled={!impact || remapTarget === aliasDef?.targets[0]} onClick={() => impact && props.onRemap(remapAlias, remapTarget)}>应用</button>
        </div>
        {impact && (
          <div className="card impact-card">
            <div>注入名 <code>{impact.aliasName}</code> <b>不变</b>（registry-order 契约不暴露实际模型名）</div>
            <div>实际命中：{impact.before ? `${impact.before.provider}/${impact.before.model}` : '（无）'} → <b>{impact.after ? `${impact.after.provider}/${impact.after.model}` : '?'}</b></div>
            <div>
              受影响 agent：
              {impact.affectedAgents.length > 0
                ? impact.affectedAgents.map((a) => <button key={a} className="btn btn-sm" onClick={() => props.onSelectAgent(a)}>{a}</button>)
                : <span className="dim">无</span>}
            </div>
          </div>
        )}
      </section>

      <section className="advisor-sec">
        <h4>fork 断点知识库 <span className="dim">（spec §2.1–§2.4）</span></h4>
        <div className="card kb-card">
          <p><b>fork ≠ 缓存延续。</b>fork 继承的是父会话的<b>前缀消息史</b>（重放），但子代理的 system 头由子的组装器<b>重新生成</b>——前缀缓存从头部就断了。</p>
          <p>fork 省的是「组装」（不用重述上下文），不是「缓存」。选 spawn/fork 时别拿缓存当理由。</p>
        </div>
      </section>

      <section className="advisor-sec">
        <h4>顺序反模式 <span className="dim">（D10）</span></h4>
        <div className="card kb-card">
          <p><span className="tag tag-err">反例</span> 把最稳的别名放最前：每次换档都在最早位置断，长任务反复重建前缀。</p>
          <p><span className="tag tag-ok">推荐</span> 按「最可能的断点最晚」排序；换档发生在 persona 之后，前面的公共前缀（model-sys 等）保住。</p>
        </div>
      </section>
    </div>
  )
}
