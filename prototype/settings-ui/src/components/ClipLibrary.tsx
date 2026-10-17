/**
 * PROTOTYPE — Prompt Sections 页：切片库。
 * 切片 = 一个具名文件（D14 1:1）；展示层遮蔽、引用方、未引用态；
 * 有引用时禁止删/改名（安全性演示）；点行展开预览。
 */
import { useState } from 'react'
import type { AgentDoc, PromptClip } from '../types'
import { layerLabel, referencedBy, resolveClip, shadowedClipNames } from '../model'

export interface ClipLibraryProps {
  clips: PromptClip[]
  agents: AgentDoc[]
  onAdd: () => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
}

export function ClipLibrary(props: ClipLibraryProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const names = [...new Set(props.clips.map((c) => c.name))]
  const shadowed = shadowedClipNames(props.clips)

  return (
    <div className="clip-lib">
      <div className="page-head">
        <h2>Prompt Sections</h2>
        <p className="page-sub">
          切片 = 一个具名提示词文件；agent 正文用 <code>$ name</code> 行引用（原型提案语法）。
          同名切片低层被遮蔽（D2：workspace 胜 user）。
        </p>
        <button className="btn" onClick={props.onAdd}>＋ 新建切片</button>
      </div>
      {names.map((name) => {
        const winner = resolveClip(name, props.clips)
        if (!winner) return null
        const layers = (shadowed.get(name) ?? 1) - 1
        const refs = referencedBy(name, props.agents)
        const used = refs.length > 0
        const isOpen = expanded === name
        return (
          <div className="card clip-row" key={name}>
            <div className="clip-main" onClick={() => setExpanded(isOpen ? null : name)}>
              <span className="clip-name">$ {name}</span>
              <span className={`tag tag-${winner.source.startsWith('project') ? 'workspace' : 'user'}`}>{layerLabel(winner.source)}</span>
              {layers > 0 && <span className="tag tag-warn" title="同名低层切片被遮蔽">遮蔽 ×{layers}</span>}
              <span className="clip-file">{winner.file}</span>
              <span className="clip-refs">
                {used ? refs.map((r) => <span key={r} className="tag tag-accent">{r}</span>) : <span className="dim">未引用</span>}
              </span>
              <span className="dim clip-lines">{winner.content.split('\n').length} 行</span>
            </div>
            <div className="clip-actions">
              <button className="btn btn-sm" disabled={used} title={used ? `被 ${refs.join('、')} 引用，改名会悬空` : '重命名（= 改文件名）'} onClick={() => props.onRename(name)}>重命名</button>
              <button className="btn btn-sm" disabled={used} title={used ? `被 ${refs.join('、')} 引用，不可删` : '删除文件'} onClick={() => props.onDelete(name)}>删除</button>
            </div>
            {isOpen && <pre className="clip-preview">{winner.content}</pre>}
          </div>
        )
      })}
    </div>
  )
}
