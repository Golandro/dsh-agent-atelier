/**
 * PROTOTYPE — Agent Edit（P1 B 区）：CodeMirror 组合文档编辑器。
 * front-matter 块打头；body 的 `$ clip` 引用行展开为 clip 块。
 * 所有块默认直接可编辑（无需双击进入）；每个块对应一个落盘文件（D14 1:1），
 * 可在块头单独保存 / 回退，也可在工具栏一次保存全部脏块（一次写多个文件）。
 * compact 仅折叠 clip 内容显示，不改变草稿与保存语义。
 */
import type { ComposedDocument, DocBlock } from '../types'
import { layerLabel, saveWrites } from '../model'
import type { ChainResult } from '../model'
import { CodeBlock } from './CodeBlock'

export interface AgentEditorProps {
  doc: ComposedDocument
  /** 未保存的块草稿：blockId → 文本（存在即编辑中/脏） */
  drafts: Record<string, string>
  onDraft: (blockId: string, text: string) => void
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

const kindLabel: Record<DocBlock['kind'], string> = {
  frontmatter: 'front-matter',
  prose: 'prose',
  clip: 'clip',
}

const sourceTag = (source: NonNullable<DocBlock['source']>) =>
  source.startsWith('project') ? 'workspace' : source === 'bundled' ? 'bundled' : 'user'

/** 组合文档里的全局行范围；按当前草稿与 compact 状态即时重算。 */
function blockRanges(
  doc: ComposedDocument,
  drafts: Record<string, string>,
  compact: boolean,
): Map<string, { start: number; end: number }> {
  const ranges = new Map<string, { start: number; end: number }>()
  let next = 1
  doc.blocks.forEach((block, i) => {
    if (i > 0) next += 1 // 块间空行
    const isClip = block.kind === 'clip'
    const headerLines = isClip ? 1 : 0
    const contentLines = block.missing || (compact && isClip)
      ? 0
      : (drafts[block.id] ?? block.text).split('\n').length
    const start = next
    const end = next + headerLines + contentLines - 1
    ranges.set(block.id, { start, end })
    next = end + 1
  })
  return ranges
}

export function AgentEditor(props: AgentEditorProps) {
  const { doc, drafts } = props
  const dirtyCount = Object.keys(drafts).length
  const pendingFiles = saveWrites(doc, drafts).length
  const ranges = blockRanges(doc, drafts, props.compact)

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
        {doc.blocks.map((block) => {
          const draft = drafts[block.id]
          const dirty = draft !== undefined
          const range = ranges.get(block.id)
          const collapsed = props.compact && block.kind === 'clip'
          const lineCount = (draft ?? block.text).split('\n').length
          const label = block.kind === 'clip' ? `clip ${block.clipName}` : kindLabel[block.kind]

          return (
            <section
              key={block.id}
              className={`ed-block${dirty ? ' dirty' : ''}${block.missing ? ' missing' : ''}${collapsed && !block.missing ? ' collapsed' : ''}`}
              data-block-id={block.id}
            >
              <header className="ed-block-head">
                <span className={`ed-block-kind kind-${block.kind}`}>{kindLabel[block.kind]}</span>
                {block.kind === 'clip' && <span className="ed-block-title">$ {block.clipName}</span>}
                {block.source && <span className={`tag tag-${sourceTag(block.source)}`}>{layerLabel(block.source)}</span>}
                <span className="ed-block-file" title={block.file}>{block.file}</span>
                <span className="ed-block-spacer" />
                {block.missing
                  ? <span className="ed-block-state missing">引用缺失</span>
                  : dirty
                    ? <span className="ed-block-state dirty">未保存</span>
                    : <span className="ed-block-state">已保存</span>}
                {range && <span className="ed-block-range" title="组合文档中的全局行范围">L{range.start}–{range.end}</span>}
                {!props.readonly && !block.missing && (
                  <span className="ed-block-actions">
                    <button
                      className="btn btn-sm"
                      disabled={!dirty}
                      onClick={() => props.onSaveBlock(block.id)}
                      title={`只回写此块 → ${block.file}`}
                    >保存此块</button>
                    <button
                      className="btn btn-sm"
                      disabled={!dirty}
                      onClick={() => props.onRevertBlock(block.id)}
                      title="撤回此块的未保存改动"
                    >回退</button>
                  </span>
                )}
              </header>

              {block.missing ? (
                <div className="ed-block-note">
                  引用的切片文件不存在：<code>$ {block.clipName}</code>。在正文删除该引用行，或创建同名切片。
                </div>
              ) : collapsed ? (
                <div className="ed-block-note">
                  {dirty ? '草稿已修改' : '内容已折叠'} · {lineCount} 行
                  <span className="dim">（compact；保存/回退仍按整块生效）</span>
                </div>
              ) : (
                <CodeBlock
                  value={draft ?? block.text}
                  language={block.kind === 'frontmatter' ? 'yaml' : 'markdown'}
                  readOnly={props.readonly}
                  ariaLabel={`${label}：${block.file}`}
                  onChange={(text) => props.onDraft(block.id, text)}
                />
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
