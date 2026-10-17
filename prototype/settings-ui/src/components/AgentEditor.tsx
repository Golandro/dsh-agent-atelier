/**
 * PROTOTYPE — Agent Edit（P1 B 区）：组合文本编辑器。
 * front-matter 块打头；body 的 `$ clip` 引用行展开为 clip 块（header 行 + 内容行）；
 * 块间强制空行（= 各块 Header 分隔）；行号全局连续，compact 折叠 clip 内容后重算。
 * 保存把每个脏块回写各自文件（一次保存可写多个文件——见 Inspector）。
 */
import { Fragment } from 'react'
import type { ComposedDocument } from '../types'
import { layerLabel, saveWrites } from '../model'
import type { ChainResult } from '../model'

export interface AgentEditorProps {
  doc: ComposedDocument
  /** 未保存的块草稿：blockId → 文本（存在即编辑中/脏） */
  drafts: Record<string, string>
  onStartEdit: (blockId: string) => void
  onDraft: (blockId: string, text: string) => void
  onDropDraft: (blockId: string) => void
  onSave: () => void
  onDiscard: () => void
  compact: boolean
  onCompact: (v: boolean) => void
  chain: ChainResult
  /** bundled agent 只读（D16：修改 = 另存到工作区根） */
  readonly?: boolean
  /** 关闭编辑器：宽屏时列表占满，窄屏时回到列表 */
  onClose: () => void
}

const lineCount = (t: string) => t.split('\n').length

export function AgentEditor(props: AgentEditorProps) {
  const { doc, drafts } = props
  const dirtyCount = Object.keys(drafts).length
  const pendingFiles = saveWrites(doc, drafts).length
  const blockById = new Map(doc.blocks.map((b) => [b.id, b]))
  const editedBlocks = new Set<string>()

  return (
    <section className="editor">
      <div className="editor-toolbar">
        <span className="editor-title">View &amp; Edit tools</span>
        <span className="editor-path" title="当前文档落盘文件（D14 1:1）">{doc.agentPath}</span>
        <span className="editor-spacer" />
        <span className="resolve-chip" title="模型链解析结果（§5.3）">
          {props.chain.hit && props.chain.via
            ? <>解析：{props.chain.via} → <b>{props.chain.hit.provider}/{props.chain.hit.model}</b></>
            : '解析：无命中'}
        </span>
        {props.readonly ? (
          <span className="tag tag-bundled">bundled 只读 · 修改 = 另存到工作区根（D16）</span>
        ) : (
          <>
            <button className="btn btn-sm btn-primary" disabled={dirtyCount === 0} onClick={props.onSave} title="回写所有脏块到各自文件">
              💾 <span className="lbl">保存{dirtyCount > 0 ? `（${dirtyCount} 块 → ${pendingFiles} 文件）` : ''}</span>
            </button>
            <button className="btn btn-sm" disabled={dirtyCount === 0} onClick={props.onDiscard}>↩ <span className="lbl">放弃</span></button>
            <label className="toggle" title="compact：折叠 clip 内容，只留 header（P1：自认为 Prompt 封装好的话）">
              <input type="checkbox" checked={props.compact} onChange={(e) => props.onCompact(e.target.checked)} />
              <span className="toggle-track" />
              <span className="lbl toggle-lbl">compact</span>
            </label>
          </>
        )}
        <button
          type="button"
          className="btn-icon editor-close"
          onClick={props.onClose}
          title="关闭编辑器"
          aria-label="关闭编辑器"
        >✕</button>
      </div>

      <div className="editor-body">
        {doc.rows.map((row, i) => {
          const n = i + 1
          const draft = drafts[row.blockId]

          if (row.role === 'separator') {
            return <div className="ed-row ed-sep" key={i}><span className="ln">{n}</span></div>
          }

          if (row.role === 'header') {
            const block = blockById.get(row.blockId)
            const collapsed = props.compact && block && !block.missing
            return (
              <Fragment key={i}>
                <div className="ed-row ed-header">
                  <span className="ln">{n}</span>
                  <span className="hdr-ref">{row.text}</span>
                  {block?.source && <span className={`tag tag-${block.source.startsWith('project') ? 'workspace' : block.source === 'bundled' ? 'bundled' : 'user'}`}>{layerLabel(block.source)}</span>}
                  <span className="hdr-file" title="该切片落盘文件">{block?.file}</span>
                  {block?.missing && <span className="tag tag-err">未找到切片</span>}
                  {collapsed && draft === undefined && <span className="hdr-collapsed">（已折叠 {lineCount(block.text)} 行）</span>}
                  {!props.readonly && !block?.missing && (
                    draft === undefined ? (
                      <button className="btn btn-sm hdr-action" onClick={() => props.onStartEdit(row.blockId)}>Clip Edit</button>
                    ) : (
                      <button className="btn btn-sm hdr-action" onClick={() => props.onDropDraft(row.blockId)} title="放弃此块改动">✕ 放弃</button>
                    )
                  )}
                </div>
                {draft !== undefined && (
                  <div className="ed-row ed-edit">
                    <span className="ln">{n + 1}–{n + lineCount(draft)}</span>
                    <textarea className="ed-area" value={draft} rows={lineCount(draft)} onChange={(e) => props.onDraft(row.blockId, e.target.value)} />
                  </div>
                )}
              </Fragment>
            )
          }

          // 文本行：所在块有草稿时，fm/prose 首个文本行换成整段 textarea，其余跳过；clip 的编辑框挂在 header 后
          if (draft !== undefined) {
            if (blockById.get(row.blockId)?.kind === 'clip') return null
            if (editedBlocks.has(row.blockId)) return null
            editedBlocks.add(row.blockId)
            return (
              <div className="ed-row ed-edit" key={i}>
                <span className="ln">{n}–{n + lineCount(draft) - 1}</span>
                <textarea className="ed-area" value={draft} rows={lineCount(draft)} onChange={(e) => props.onDraft(row.blockId, e.target.value)} />
              </div>
            )
          }

          const block = blockById.get(row.blockId)
          const startable = !props.readonly && block && (block.kind === 'frontmatter' || block.kind === 'prose')
          return (
            <div
              className={`ed-row ed-text${startable ? ' editable' : ''}`}
              key={i}
              onDoubleClick={startable ? () => props.onStartEdit(row.blockId) : undefined}
              title={startable ? '双击编辑此块' : undefined}
            >
              <span className="ln">{n}</span>
              <span className="ed-line">{row.text || ' '}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
