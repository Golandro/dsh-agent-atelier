/**
 * PROTOTYPE — Agent Edit（P1 B 区）：单个 CodeMirror 组合文档编辑器。
 * front-matter 块打头；body 的 `{% include clip <name> %}` 模板行原地成为 clip header，
 * clip 内容内联在模板行之后。所有内容默认直接可编辑；每个块对应一个落盘文件（D14 1:1），
 * 可在块头单独保存 / 回退，也可在工具栏一次保存全部脏块（一次写多个文件）。
 * compact 仅折叠 clip 内容显示，不改变草稿与保存语义；
 * 单个切片也可通过 CodeMirror gutter 的折叠按钮独立收起/展开。
 *
 * 头部固定两行：第一行是 agent 身份（名称 / 路径 / 复制与详情），
 * 第二行是文档级操作（折叠、回退、保存）。模型链解析暂不在编辑器展示。
 * 窗格变窄时按优先级压缩而不是整组隐藏：文案换短、路径左截断保留文件名；
 * 更窄时路径与复制让位给详情弹层，折叠上移到第一行，第二行只留状态与写盘动作。
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentSource, ComposedDocument } from '../types'
import { layerLabel, saveWrites } from '../model'
import { DocumentEditor } from './DocumentEditor'

export interface AgentEditorProps {
  doc: ComposedDocument
  /** agent 自身的发现层（写入详情弹层，不占用两行头部） */
  source: AgentSource
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
  /** bundled agent 只读（D16：修改 = 另存到工作区根） */
  readonly?: boolean
  /** 关闭编辑器：宽屏时列表占满，窄屏时回到列表 */
  onClose: () => void
}

type CopyTarget = 'path' | 'doc'

/** 同一动作的三档文案：完整 / 紧凑 / 极窄。由容器查询切换，避免窄窗格直接丢功能。 */
function TieredLabel({ full, compact, tiny }: { full: string; compact: string; tiny?: string }) {
  return (
    <>
      <span className="lbl-full">{full}</span>
      <span className="lbl-compact">{compact}</span>
      {tiny !== undefined && <span className="lbl-tiny">{tiny}</span>}
    </>
  )
}

export function AgentEditor(props: AgentEditorProps) {
  const { doc, drafts } = props
  const dirtyCount = Object.keys(drafts).length
  const pendingFiles = saveWrites(doc, drafts).length
  const frontmatterCount = doc.blocks.filter((block) => block.kind === 'frontmatter').length
  const clipBlocks = doc.blocks.filter((block) => block.kind === 'clip')
  const missingClips = clipBlocks.filter((block) => block.missing).length
  const lineCount = doc.text === '' ? 0 : doc.text.split('\n').length

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copyState, setCopyState] = useState<{ target: CopyTarget; ok: boolean } | null>(null)
  const infoRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const copy = async (target: CopyTarget, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState({ target, ok: true })
      return
    } catch {
      // 受限 iframe / 无权限环境回退到 execCommand，仍然给出成功或失败反馈。
    }
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    document.body.append(textarea)
    textarea.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    textarea.remove()
    setCopyState({ target, ok })
  }

  const copyContent = (target: CopyTarget, full: string, compact: string) =>
    copyState?.target === target
      ? <span className="copy-feedback">{copyState.ok ? '已复制' : '复制失败'}</span>
      : <TieredLabel full={full} compact={compact} />

  useEffect(() => {
    if (!copyState) return
    const timer = window.setTimeout(() => setCopyState(null), 1400)
    return () => window.clearTimeout(timer)
  }, [copyState])

  // 弹层只做只读信息与复制动作：Escape / 点击外部关闭，避免遮住文档时无法退出。
  useEffect(() => {
    if (!detailsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false)
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && (popRef.current?.contains(target) || infoRef.current?.contains(target))) return
      setDetailsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [detailsOpen])

  useEffect(() => {
    setDetailsOpen(false)
    setCopyState(null)
  }, [doc.agentName])

  return (
    <section className="editor">
      <header className="editor-head">
        <div className="editor-titlebar">
          <span className="editor-title" title={doc.agentName}>{doc.agentName}</span>
          <span className="editor-path" title={`当前文档落盘文件（D14 1:1）：${doc.agentPath}`}>
            <span className="editor-path-text">{doc.agentPath}</span>
          </span>
          {props.readonly && (
            <span
              className="tag tag-bundled"
              title="bundled 只读（D16）：修改 = 另存到工作区根"
            >
              <TieredLabel full="只读 · 另存到工作区根" compact="只读" />
            </span>
          )}
          <span className="editor-spacer" />
          <div className="editor-utils">
            {!props.readonly && (
              <button
                type="button"
                className="btn btn-sm editor-fold editor-fold-inline"
                aria-pressed={props.compact}
                aria-label={props.compact ? '展开切片' : '折叠切片'}
                onClick={() => props.onCompact(!props.compact)}
                title="仅折叠显示：收起/展开全部切片正文，不改变草稿与文件；也可用 gutter 的折叠按钮单独控制"
              >
                <TieredLabel
                  full={props.compact ? '展开切片' : '折叠切片'}
                  compact={props.compact ? '展开' : '折叠'}
                />
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm editor-util"
              onClick={() => void copy('path', doc.agentPath)}
              title="复制 agent 文件路径"
            >{copyContent('path', '复制路径', '路径')}</button>
            <button
              type="button"
              className="btn btn-sm editor-util"
              onClick={() => void copy('doc', doc.text)}
              title="复制组合文档全文（含 front-matter 与内联切片）"
            >{copyContent('doc', '复制全文', '全文')}</button>
            <button
              ref={infoRef}
              type="button"
              className="btn-icon editor-info"
              aria-label="文档详情"
              aria-expanded={detailsOpen}
              aria-controls="editor-doc-details"
              title="文档详情"
              onClick={() => setDetailsOpen((open) => !open)}
            >ⓘ</button>
            <button
              type="button"
              className="btn-icon editor-close"
              onClick={props.onClose}
              title="关闭编辑器"
              aria-label="关闭编辑器"
            >×</button>
          </div>
        </div>

        {!props.readonly && (
          <div className="editor-toolbar">
            {dirtyCount > 0 ? (
              <span className="editor-dirty-chip" title="未保存的块与将写入的文件数">
                <TieredLabel
                  full={`${dirtyCount} 块未保存 → ${pendingFiles} 文件`}
                  compact={`${dirtyCount} 块未保存`}
                  tiny={`${dirtyCount} 块`}
                />
              </span>
            ) : (
              <span className="editor-status" title="当前文档没有未保存的改动">
                <TieredLabel full="无未保存改动" compact="已保存" />
              </span>
            )}
            <span className="editor-spacer" />
            <button
              type="button"
              className="btn btn-sm editor-fold"
              aria-pressed={props.compact}
              aria-label={props.compact ? '展开切片' : '折叠切片'}
              onClick={() => props.onCompact(!props.compact)}
              title="仅折叠显示：收起/展开全部切片正文，不改变草稿与文件；也可用 gutter 的折叠按钮单独控制"
            >
              <TieredLabel
                full={props.compact ? '展开切片' : '折叠切片'}
                compact={props.compact ? '展开' : '折叠'}
              />
            </button>
            <span className="editor-tool-sep" aria-hidden="true" />
            <button
              className="btn btn-sm"
              disabled={dirtyCount === 0}
              onClick={props.onDiscard}
              aria-label="全部回退"
              title="撤回所有块的未保存改动"
            >
              <TieredLabel full="全部回退" compact="回退" />
            </button>
            <button className="btn btn-sm btn-primary" disabled={dirtyCount === 0} onClick={props.onSave} title="回写所有脏块到各自文件">
              <TieredLabel
                full={dirtyCount > 0 ? `保存全部（${dirtyCount} 块）` : '保存全部'}
                compact={dirtyCount > 0 ? `保存 ${dirtyCount} 块` : '保存'}
              />
            </button>
          </div>
        )}

        {detailsOpen && (
          <div
            ref={popRef}
            id="editor-doc-details"
            className="editor-detail-pop"
            role="dialog"
            aria-label="文档详情"
          >
            <h4>文档详情</h4>
            <dl className="editor-detail-list">
              <dt>agent</dt>
              <dd className="mono">{doc.agentName}</dd>
              <dt>层级</dt>
              <dd>{layerLabel(props.source)}{props.readonly ? ' · 只读' : ''}</dd>
              <dt>文件</dt>
              <dd className="mono">{doc.agentPath}</dd>
              <dt>结构</dt>
              <dd>
                front-matter {frontmatterCount} · clip {clipBlocks.length}
                {missingClips > 0 ? `（${missingClips} 缺失）` : ''} · {lineCount} 行
              </dd>
              <dt>未保存</dt>
              <dd>{dirtyCount === 0 ? '无' : `${dirtyCount} 块 → ${pendingFiles} 文件`}</dd>
            </dl>
            <div className="editor-detail-foot">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void copy('path', doc.agentPath)}
              >{copyContent('path', '复制路径', '路径')}</button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void copy('doc', doc.text)}
              >{copyContent('doc', '复制全文', '全文')}</button>
            </div>
          </div>
        )}
      </header>

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
