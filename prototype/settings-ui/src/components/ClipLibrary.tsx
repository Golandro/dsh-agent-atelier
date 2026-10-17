/**
 * PROTOTYPE — Prompt Sections 页：切片库（主从双栏）。
 * 切片 = 一个具名文件（D14 1:1），同名多文件按层遮蔽解析出唯一生效版本（D2：workspace 胜 user）。
 * 列表只承担「检索 + 选中」；详情承担元信息、引用语法与内容预览。
 * 分栏策略与 Agent 页完全一致（usePaneLayout）：同一套最小宽度、拖拽夹取与浮层阈值；
 * 详情可关闭（× / 返回），关闭后列表占满。
 * 引用是切片的常态：不出现警告条，头部用「引用列表」代替不可用的「删除」。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AgentDoc, LayerTag, PromptClip } from '../types'
import { clipIncludeLine, layerLabel, layerTag, referencedBy, resolveClip } from '../model'
import { PANE_CONTENT_MIN_REM, PANE_LIST_MIN_REM, paneSplitThreshold, usePaneLayout } from '../pane-layout'
import { ListPane } from './ListPane'
import { PaneSplitter } from './PaneSplitter'

export interface ClipLibraryProps {
  clips: PromptClip[]
  agents: AgentDoc[]
  /** 模拟磁盘上的已保存内容（与组合文档共用；键为 `clip-<name>`） */
  overrides?: Record<string, string>
  onAdd: () => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
  /** 点引用方 chip 跳到 Agents 页（可选；不传则只读展示） */
  onOpenAgent?: (agentName: string) => void
  /** 新建后要聚焦的切片名（由上层在新建时置入） */
  focusName?: string | null
  onFocusConsumed?: () => void
}

type SortKey = 'name' | 'refs' | 'size'
const SORT_LABEL: Record<SortKey, string> = { name: '名称', refs: '引用数', size: '体积' }

interface SectionRow {
  name: string
  winner: PromptClip
  /** 生效内容：已保存覆盖优先，否则取 winner 原文 */
  content: string
  /** 同名所有层（含 winner），长度 > 1 即存在遮蔽 */
  layers: PromptClip[]
  refs: string[]
  lines: number
  chars: number
}

export function ClipLibrary(props: ClipLibraryProps) {
  const [text, setText] = useState('')
  const [layer, setLayer] = useState<LayerTag | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [onlyUnreferenced, setOnlyUnreferenced] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(() => props.clips[0]?.name ?? null)
  /** 详情初始与 Agent 编辑器同策略：放得下才默认并列，窄容器先看列表 */
  const [detailOpen, setDetailOpen] = useState(() => window.innerWidth >= paneSplitThreshold())
  /** 引用列表菜单（只在有引用时出现，替代不可用的“删除”） */
  const [refsOpen, setRefsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  const pageRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const { focusName, onFocusConsumed } = props
  const pane = usePaneLayout(pageRef)

  const allRows = useMemo<SectionRow[]>(() => {
    const names = [...new Set(props.clips.map((c) => c.name))]
    return names.flatMap((name) => {
      const winner = resolveClip(name, props.clips)
      if (!winner) return []
      const content = props.overrides?.[`clip-${name}`] ?? winner.content
      return [{
        name,
        winner,
        content,
        layers: props.clips.filter((c) => c.name === name),
        refs: referencedBy(name, props.agents),
        lines: content.split('\n').length,
        chars: content.length,
      }]
    })
  }, [props.clips, props.agents, props.overrides])

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase()
    const filtered = allRows.filter((row) => {
      if (layer !== 'all' && layerTag(row.winner.source) !== layer) return false
      if (onlyUnreferenced && row.refs.length > 0) return false
      if (!q) return true
      return `${row.name}\n${row.winner.file}\n${row.refs.join(' ')}`.toLowerCase().includes(q)
    })
    const byName = (a: SectionRow, b: SectionRow) => a.name.localeCompare(b.name, 'zh-CN')
    return filtered.sort((a, b) => {
      if (sort === 'refs') return b.refs.length - a.refs.length || byName(a, b)
      if (sort === 'size') return b.chars - a.chars || byName(a, b)
      return byName(a, b)
    })
  }, [allRows, text, layer, sort, onlyUnreferenced])

  /** 选中项按全量解析：详情字段不依赖当前列表子集。 */
  const active = allRows.find((r) => r.name === selectedName) ?? null
  const used = (active?.refs.length ?? 0) > 0

  // 选中项被筛选挡掉或已删除时，跟到列表中第一条，避免「列表一条、详情另一条」的割裂。
  // 列表为空（无匹配）时保留原选中，详情仍可阅读。
  useEffect(() => {
    if (rows.length === 0) return
    if (selectedName && rows.some((r) => r.name === selectedName)) return
    setSelectedName(rows[0]?.name ?? null)
  }, [rows, selectedName])

  // 新建切片：聚焦新条目（窄容器下同时升起详情）。
  useEffect(() => {
    if (!focusName || !allRows.some((r) => r.name === focusName)) return
    setSelectedName(focusName)
    setDetailOpen(true)
    onFocusConsumed?.()
  }, [focusName, allRows, onFocusConsumed])

  useEffect(() => setCopied(false), [selectedName])
  // 引用菜单只属于当前条目；换选中或关闭详情时一并收起。
  useEffect(() => setRefsOpen(false), [selectedName, detailOpen])
  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  const selectRow = (name: string) => {
    setSelectedName(name)
    setDetailOpen(true)
  }

  const moveSelection = (delta: 1 | -1) => {
    if (rows.length === 0) return
    const index = rows.findIndex((r) => r.name === selectedName)
    const next = rows[Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))]
    if (!next) return
    setSelectedName(next.name)
    listRef.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(next.name)}"]`)?.focus()
  }

  const copyInclude = async (name: string) => {
    try {
      await navigator.clipboard.writeText(clipIncludeLine(name))
    } catch {
      /* 原型：剪贴板不可用不阻塞演示，仍给出反馈 */
    }
    setCopied(true)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1400)
  }

  const resetFilters = () => {
    setText('')
    setLayer('all')
    setOnlyUnreferenced(false)
  }

  return (
    <section
      ref={pageRef}
      className={`sections-page${pane.overlay ? ' editor-overlay' : ''}${detailOpen ? '' : ' detail-closed'}`}
      aria-label="Prompt Sections"
    >
      <div className="sections-body" style={{ '--sections-list-w': `${pane.listWidth}px` } as CSSProperties}>
        <ListPane
          listRef={listRef}
          className="sections-list"
          title="Section List"
          count={`${rows.length}/${allRows.length}`}
          headAction={
            <button type="button" className="btn btn-sm" onClick={props.onAdd}>＋ 新建</button>
          }
          tools={
            <>
              <input
                className="input list-search"
                type="search"
                value={text}
                placeholder="搜索名称 / 文件 / 引用方"
                aria-label="搜索切片"
                onChange={(e) => setText(e.target.value)}
              />
              <div className="list-filter-row">
                <select
                  className="select list-filter"
                  value={layer}
                  aria-label="按层级筛选"
                  onChange={(e) => setLayer(e.target.value as LayerTag | 'all')}
                >
                  <option value="all">全部层级</option>
                  <option value="workspace">workspace</option>
                  <option value="user">user</option>
                  <option value="bundled">bundled</option>
                </select>
                <select
                  className="select list-filter"
                  value={sort}
                  aria-label="排序方式"
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                    <option key={key} value={key}>按{SORT_LABEL[key]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`btn btn-sm${onlyUnreferenced ? ' btn-primary' : ''}`}
                  aria-pressed={onlyUnreferenced}
                  title="只看没有被任何 agent 引用的切片（可安全删除）"
                  onClick={() => setOnlyUnreferenced((v) => !v)}
                >仅未引用</button>
              </div>
            </>
          }
          bodyRole="listbox"
          bodyLabel="切片列表"
          onBodyKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              moveSelection(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              moveSelection(-1)
            }
          }}
        >
          {rows.map((row) => {
            const hidden = row.layers.length - 1
            const selected = row.name === selectedName
            return (
              <button
                key={row.name}
                type="button"
                role="option"
                aria-selected={selected}
                data-section={row.name}
                className={`section-row${selected ? ' selected' : ''}`}
                onClick={() => selectRow(row.name)}
              >
                <span className="section-row-main">
                  <span className="section-name" title={row.name}>{row.name}</span>
                  {hidden > 0 && <span className="tag tag-warn section-shadow-tag" title="同名低层切片被遮蔽">遮蔽 {hidden}</span>}
                  <span className="section-row-flex" />
                  <span className={`section-ref-count${row.refs.length === 0 ? ' none' : ''}`} title={row.refs.length === 0 ? '未被引用' : `被 ${row.refs.length} 个 agent 引用`}>
                    {row.refs.length === 0 ? '未引用' : `Agent ×${row.refs.length}`}
                  </span>
                </span>
                <span className="section-row-sub">
                  <span className={`tag tag-${layerTag(row.winner.source)}`}>{layerLabel(row.winner.source)}</span>
                  <span className="section-path" title={row.winner.file}>
                    <span className="section-path-text">{row.winner.file}</span>
                  </span>
                </span>
              </button>
            )
          })}
          {rows.length === 0 && (
            <div className="list-empty">
              <div className="section-empty-title">没有匹配的切片</div>
              <div>换关键词，或清除当前筛选</div>
              <button type="button" className="btn btn-sm" onClick={resetFilters}>清除筛选</button>
            </div>
          )}
        </ListPane>

        <PaneSplitter
          className="sections-splitter"
          label={`调整列表宽度（列表最小 ${PANE_LIST_MIN_REM}rem，详情最小 ${PANE_CONTENT_MIN_REM}rem）`}
          value={pane.listWidth}
          min={pane.minList}
          max={pane.maxListWidth}
          onResize={pane.setListWidth}
          onReset={pane.resetListWidth}
        />

        <div className="sections-detail">
          {active ? (
            <>
              <div className="section-detail-head">
                <button type="button" className="btn btn-sm section-back" onClick={() => setDetailOpen(false)}>← 返回</button>
                <span className="section-detail-name" title={active.name}>{active.name}</span>
                <span className={`tag tag-${layerTag(active.winner.source)}`}>{layerLabel(active.winner.source)}</span>
                {active.layers.length > 1 && <span className="tag tag-warn" title="同名低层切片被遮蔽">遮蔽 {active.layers.length - 1}</span>}
                <span className="section-detail-fill" />
                <button
                  type="button"
                  className="btn btn-sm section-copy"
                  title={clipIncludeLine(active.name)}
                  onClick={() => copyInclude(active.name)}
                >{copied ? '已复制' : '复制引用'}</button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={used}
                  title={used ? '被引用中：改名会让引用悬空，先在 Agents 页解除引用' : '重命名（= 改文件名；引用方需同步改引用行）'}
                  onClick={() => props.onRename(active.name)}
                >重命名</button>
                {used ? (
                  <span className="menu-anchor section-refs-anchor">
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-haspopup="menu"
                      aria-expanded={refsOpen}
                      onClick={() => setRefsOpen((v) => !v)}
                    >引用列表</button>
                    {refsOpen && (
                      <>
                        <div className="menu-backdrop" onClick={() => setRefsOpen(false)} />
                        <div className="menu menu-right section-refs-menu" role="menu" aria-label={`${active.name} 的引用列表`}>
                          <div className="section-refs-head">Agent 引用 · {active.refs.length}</div>
                          {active.refs.map((r) => props.onOpenAgent ? (
                            <button
                              key={r}
                              type="button"
                              role="menuitem"
                              className="menu-item"
                              onClick={() => {
                                setRefsOpen(false)
                                props.onOpenAgent?.(r)
                              }}
                            >
                              <span className="mono">{r}</span>
                              <span className="section-refs-hint">打开</span>
                            </button>
                          ) : (
                            <div key={r} role="menuitem" className="menu-item"><span className="mono">{r}</span></div>
                          ))}
                        </div>
                      </>
                    )}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm section-delete"
                    title="删除文件"
                    onClick={() => props.onDelete(active.name)}
                  >删除</button>
                )}
                <button
                  type="button"
                  className="btn-icon section-close"
                  onClick={() => setDetailOpen(false)}
                  title="关闭详情"
                  aria-label="关闭详情"
                >×</button>
              </div>

              <dl className="section-meta">
                <div className="section-meta-file">
                  <dt>文件</dt>
                  <dd className="mono">{active.winner.file}</dd>
                </div>
                <div>
                  <dt>引用</dt>
                  <dd>
                    {active.refs.length === 0
                      ? <span className="dim">未引用 · 可安全删除</span>
                      : <span className="section-ref-summary">Agent ×{active.refs.length}</span>}
                  </dd>
                </div>
                <div>
                  <dt>体积</dt>
                  <dd>{active.lines} 行 · {active.chars} 字符</dd>
                </div>
                {active.layers.length > 1 && (
                  <div className="section-meta-grow">
                    <dt>被遮蔽</dt>
                    <dd className="section-meta-stack">
                      {active.layers
                        .filter((l) => l.file !== active.winner.file || l.source !== active.winner.source)
                        .map((l) => (
                          <span key={`${l.source}:${l.file}`} className="mono" title={`${layerLabel(l.source)} · ${l.file}`}>{l.file}</span>
                        ))}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="section-preview">
                <div className="section-preview-bar">
                  <span>内容预览</span>
                  <code className="section-include" title={clipIncludeLine(active.name)}>{clipIncludeLine(active.name)}</code>
                  <span className="section-fill" />
                  <span className="section-preview-note">只读 · {active.lines} 行</span>
                </div>
                <div className="section-code">
                  {active.content.split('\n').map((line, i) => (
                    <div className="section-code-line" key={i}>
                      <span className="section-ln">{i + 1}</span>
                      <span className={/^#{1,6}\s/.test(line) ? 'section-code-text is-heading' : 'section-code-text'}>{line || '\u00a0'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="sections-empty">
              <div className="section-empty-title">未选择切片</div>
              <div>在左侧选择一条切片，查看元信息、引用关系与文件内容</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
