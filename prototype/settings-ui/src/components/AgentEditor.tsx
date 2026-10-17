/**
 * PROTOTYPE — Agent Edit（P1 B 区）：单个 CodeMirror 组合文档编辑器。
 * front-matter 块打头；body 的 `{% include clip <name> %}` 模板行原地成为 clip header，
 * clip 内容内联在模板行之后。所有内容默认直接可编辑；每个块对应一个落盘文件（D14 1:1），
 * 可在块头单独保存 / 回退，也可在工具栏一次保存全部脏块（一次写多个文件）。
 * compact 仅折叠 clip 内容显示，不改变草稿与保存语义。
 */
import type { ComposedDocument } from '../types'
import { saveWrites } from '../model'
import type { ChainResult } from '../model'
import { DocumentEditor } from './DocumentEditor'

export interface AgentEditorProps {
  doc: ComposedDocument
  /** 未保存的块草稿：blockId → 文本（存在即编辑中/脏） */
  drafts: Record<string, string>
  /** 单编辑器回传整篇文档的块文本 */
  onDrafts: (texts: Record<string, string>) => void
  onSaveBlock: (blockId: string) => void
  onRevertBlock: (blockId: string) => void
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

export function AgentEditor(props: AgentEditorProps) {
  const { doc, drafts } = props
  const dirtyCount = Object.keys(drafts).length
  const pendingFiles = saveWrites(doc, drafts).length

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
            {dirtyCount > 0 && (
              <span className="editor-dirty-chip" title="未保存的块与将写入的文件数">
                {dirtyCount} 块未保存 → {pendingFiles} 文件
              </span>
            )}
            <button className="btn btn-sm btn-primary" disabled={dirtyCount === 0} onClick={props.onSave} title="回写所有脏块到各自文件">
              💾 <span className="lbl">保存全部{dirtyCount > 0 ? `（${dirtyCount} 块）` : ''}</span>
            </button>
            <button className="btn btn-sm" disabled={dirtyCount === 0} onClick={props.onDiscard} title="撤回所有块的未保存改动">↩ <span className="lbl">全部回退</span></button>
            <label className="toggle" title="compact：折叠 clip 内容，只留块头（不影响草稿）">
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
        <DocumentEditor
          key={doc.agentName}
          doc={doc}
          drafts={drafts}
          compact={props.compact}
          readonly={props.readonly}
          onDrafts={props.onDrafts}
          onSaveBlock={props.onSaveBlock}
          onRevertBlock={props.onRevertBlock}
        />
      </div>
    </section>
  )
}
