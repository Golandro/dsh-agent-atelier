/**
 * PROTOTYPE — 模型关联页：别名 + 模型集合的 registry 管理（主从双栏）。
 *
 * 空间 = registry.yaml 的层：工作区层（<project>/.dsh/agents/registry.yaml）压过
 * 用户层（$DSH_HOME/agents/registry.yaml），同名条目工作区胜；「合并」视图展示
 * 按层解析后的生效条目与遮蔽关系。别名是纯指针（S5：改目标 = 注入名不变），
 * 因此详情把「别名 → 模型条目 → agent」的关联链摆在主位。
 *
 * 与 Agent / Prompt Sections 共用同一套主从外壳（ListPane + PaneSplitter + usePaneLayout），
 * 列表只负责检索与选中；详情负责解析、重映射、可用性与引用。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AgentDoc, AgentSource, AliasDef, LayerTag, ModelDef } from '../types'
import {
  agentsUsingAlias,
  aliasKey,
  aliasesPointingAt,
  layerLabel,
  layerTag,
  modelKey,
  resolveAlias,
  resolveModel,
} from '../model'
import { PANE_CONTENT_MIN_REM, PANE_LIST_MIN_REM, paneSplitThreshold, usePaneLayout } from '../pane-layout'
import { ListPane } from './ListPane'
import { PaneSplitter } from './PaneSplitter'

export type RegistrySpace = 'workspace' | 'user' | 'merged'
export type RegistryKind = 'alias' | 'model'

export interface ModelLinkFocus {
  kind: RegistryKind
  name: string
  source: AgentSource
}

export interface ModelLinksProps {
  models: ModelDef[]
  aliases: AliasDef[]
  agents: AgentDoc[]
  onSetAvailable: (source: AgentSource, modelName: string, available: boolean) => void
  /** 改目标（S5）；source 指定被编辑的那一层记录 */
  onRemap: (source: AgentSource, alias: string, target: string) => void
  onDeleteAlias: (source: AgentSource, alias: string) => void
  onDeleteModel: (source: AgentSource, modelName: string) => void
  onAddAlias: (space: 'workspace' | 'user') => void
  onAddModel: (space: 'workspace' | 'user') => void
  onOpenAgent: (agentName: string) => void
  onOpenPrompt: (modelName: string) => void
  /** 新建后的聚焦目标（由上层持有，消费后清空） */
  focus?: ModelLinkFocus | null
  onFocusConsumed?: () => void
}

type SortKey = 'name' | 'refs' | 'layer'

const SORT_LABEL: Record<SortKey, string> = { name: '名称', refs: '引用数', layer: '层级' }

const SPACES: { id: RegistrySpace; label: string; title: string }[] = [
  { id: 'workspace', label: '工作区', title: '工作区层 · .dsh/agents/registry.yaml（同名条目压过用户层）' },
  { id: 'user', label: '用户', title: '用户层 · ~/.dsh/agents/registry.yaml（低优先级）' },
  { id: 'merged', label: '合并', title: '合并视图：按层解析出的生效条目（工作区胜 user）' },
]

const SPACE_RANK: Record<LayerTag, number> = { workspace: 0, user: 1, bundled: 2 }

interface AliasRow {
  key: string
  name: string
  /** 当前空间里的这条记录（合并视图 = 生效记录） */
  record: AliasDef
  /** 同名所有层 */
  layers: AliasDef[]
  /** 解析后的生效记录（工作区胜） */
  winner: AliasDef
  target?: ModelDef
  users: string[]
}

interface ModelRow {
  key: string
  name: string
  record: ModelDef
  layers: ModelDef[]
  winner: ModelDef
  /** 指向该模型名的生效别名 */
  aliases: AliasDef[]
  /** 经别名到达该模型的 agent（按 agent 去重，via 合并多条路径） */
  reach: { agent: string; via: string[] }[]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-CN')

function buildAliasRows(aliases: AliasDef[], models: ModelDef[], agents: AgentDoc[], space: RegistrySpace): AliasRow[] {
  const records = space === 'merged'
    ? [...new Set(aliases.map((a) => a.alias))].flatMap((name) => resolveAlias(name, aliases) ?? [])
    : aliases.filter((a) => layerTag(a.source) === space)
  return records.map((record) => {
    const layers = aliases.filter((a) => a.alias === record.alias)
    return {
      key: space === 'merged' ? `alias:${record.alias}` : `alias:${aliasKey(record)}`,
      name: record.alias,
      record,
      layers,
      winner: resolveAlias(record.alias, aliases) ?? record,
      target: resolveModel(record.targets[0] ?? '', models),
      users: agentsUsingAlias(record.alias, agents),
    }
  })
}

function buildModelRows(models: ModelDef[], aliases: AliasDef[], agents: AgentDoc[], space: RegistrySpace): ModelRow[] {
  const records = space === 'merged'
    ? [...new Set(models.map((m) => m.modelName))].flatMap((name) => resolveModel(name, models) ?? [])
    : models.filter((m) => layerTag(m.source) === space)
  return records.map((record) => {
    const layers = models.filter((m) => m.modelName === record.modelName)
    const pointing = aliasesPointingAt(record.modelName, aliases)
    const reachMap = new Map<string, string[]>()
    for (const al of pointing) {
      for (const agent of agentsUsingAlias(al.alias, agents)) {
        const vias = reachMap.get(agent) ?? []
        if (!vias.includes(al.alias)) vias.push(al.alias)
        reachMap.set(agent, vias)
      }
    }
    const reach = [...reachMap].map(([agent, via]) => ({ agent, via }))
    return {
      key: space === 'merged' ? `model:${record.modelName}` : `model:${modelKey(record)}`,
      name: record.modelName,
      record,
      layers,
      winner: resolveModel(record.modelName, models) ?? record,
      aliases: pointing,
      reach,
    }
  })
}

function shadowNote<T extends { source: AgentSource; path?: string }>(record: T, winner: T, layers: T[]): string {
  if (winner.source !== record.source) return `被 ${layerLabel(winner.source)} 同名条目覆盖`
  const lower = layers.filter((l) => l.source !== record.source)
  if (lower.length === 0) return ''
  return `覆盖 ${lower.length} 个低层同名条目（${lower.map((l) => layerLabel(l.source)).join('、')}）`
}

export function ModelLinks(props: ModelLinksProps) {
  const [text, setText] = useState('')
  const [space, setSpace] = useState<RegistrySpace>('merged')
  const [mode, setMode] = useState<RegistryKind>('alias')
  const [sort, setSort] = useState<SortKey>('name')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /** 详情初始与其它主从页同策略：放得下才默认并列 */
  const [detailOpen, setDetailOpen] = useState(() => window.innerWidth >= paneSplitThreshold())
  const [refsOpen, setRefsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  const pageRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const pane = usePaneLayout(pageRef)
  const { focus, onFocusConsumed } = props

  const allAliasRows = useMemo(
    () => buildAliasRows(props.aliases, props.models, props.agents, space),
    [props.aliases, props.models, props.agents, space],
  )
  const allModelRows = useMemo(
    () => buildModelRows(props.models, props.aliases, props.agents, space),
    [props.models, props.aliases, props.agents, space],
  )

  const aliasRows = useMemo(() => {
    const q = text.trim().toLowerCase()
    const filtered = allAliasRows.filter((row) => {
      if (onlyProblems && row.target && row.target.available) return false
      if (!q) return true
      return [
        row.name,
        row.record.targets.join(' '),
        row.target ? `${row.target.provider}/${row.target.model} ${row.target.modelName}` : '',
        row.record.path ?? '',
        row.users.join(' '),
        layerLabel(row.record.source),
      ].join('\n').toLowerCase().includes(q)
    })
    return filtered.sort((a, b) => {
      if (sort === 'refs') return b.users.length - a.users.length || byName(a, b)
      if (sort === 'layer') return SPACE_RANK[layerTag(a.record.source)] - SPACE_RANK[layerTag(b.record.source)] || byName(a, b)
      return byName(a, b)
    })
  }, [allAliasRows, text, sort, onlyProblems])

  const modelRows = useMemo(() => {
    const q = text.trim().toLowerCase()
    const filtered = allModelRows.filter((row) => {
      if (onlyProblems && row.record.available) return false
      if (!q) return true
      return [
        row.name,
        `${row.record.provider}/${row.record.model}`,
        row.record.path ?? '',
        row.aliases.map((a) => a.alias).join(' '),
        row.reach.map((r) => `${r.agent} ${r.via}`).join(' '),
        layerLabel(row.record.source),
      ].join('\n').toLowerCase().includes(q)
    })
    return filtered.sort((a, b) => {
      if (sort === 'refs') return b.aliases.length - a.aliases.length || byName(a, b)
      if (sort === 'layer') return SPACE_RANK[layerTag(a.record.source)] - SPACE_RANK[layerTag(b.record.source)] || byName(a, b)
      return byName(a, b)
    })
  }, [allModelRows, text, sort, onlyProblems])

  const rows = mode === 'alias' ? aliasRows : modelRows
  const allRows = mode === 'alias' ? allAliasRows : allModelRows

  /** 选中按全量解析：详情不随搜索筛选消失。 */
  const activeAlias = mode === 'alias' ? allAliasRows.find((r) => r.key === selectedKey) ?? null : null
  const activeModel = mode === 'model' ? allModelRows.find((r) => r.key === selectedKey) ?? null : null
  const active = activeAlias ?? activeModel
  const activeName = activeAlias?.name ?? activeModel?.name ?? null
  const activeLayerNote = active
    ? space === 'merged' && active.layers.length > 1
      ? `遮蔽 ${active.layers.length - 1}`
      : space === 'workspace' && active.layers.length > 1
        ? `覆盖 ${active.layers.length - 1}`
        : space === 'user' && active.winner.source !== active.record.source
          ? '被覆盖'
          : null
    : null

  // 选中项不存在（切空间 / 切类别 / 被删）时跟到第一条。
  useEffect(() => {
    if (allRows.length === 0) {
      setSelectedKey(null)
      return
    }
    if (!allRows.some((r) => r.key === selectedKey)) setSelectedKey(allRows[0]!.key)
  }, [allRows, selectedKey])

  // 新建后聚焦：切到对应类别，选中并升起详情。
  useEffect(() => {
    if (!focus) return
    const targetRows = focus.kind === 'alias' ? allAliasRows : allModelRows
    const row = targetRows.find((r) => r.name === focus.name && r.record.source === focus.source)
      ?? targetRows.find((r) => r.name === focus.name)
    if (!row) return
    setMode(focus.kind)
    setSelectedKey(row.key)
    setDetailOpen(true)
    onFocusConsumed?.()
  }, [focus, allAliasRows, allModelRows, onFocusConsumed])

  useEffect(() => setCopied(false), [selectedKey, mode])
  useEffect(() => setRefsOpen(false), [selectedKey, mode, detailOpen])
  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  // 详情里的关联跳转：目标可能不在当前空间（如从合并视图跳到用户层条目），必要时切回合并。
  const openAliasByName = (name: string) => {
    setMode('alias')
    if (!allAliasRows.some((r) => r.name === name)) setSpace('merged')
    const row = [...allAliasRows, ...buildAliasRows(props.aliases, props.models, props.agents, 'merged')]
      .find((r) => r.name === name)
    if (row) setSelectedKey(row.key)
  }

  const selectRow = (key: string) => {
    setSelectedKey(key)
    setDetailOpen(true)
  }

  const moveSelection = (delta: 1 | -1) => {
    if (rows.length === 0) return
    const index = rows.findIndex((r) => r.key === selectedKey)
    const next = rows[Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))]
    if (!next) return
    setSelectedKey(next.key)
    listRef.current?.querySelector<HTMLElement>(`[data-model-row="${CSS.escape(next.key)}"]`)?.focus()
  }

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
    } catch {
      /* 原型：剪贴板不可用不阻塞演示 */
    }
    setCopied(true)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1400)
  }

  const resetFilters = () => {
    setText('')
    setOnlyProblems(false)
  }

  const summary = useMemo(() => {
    const count = (items: { source: AgentSource }[], predicate?: (source: AgentSource) => boolean) =>
      items.filter((i) => predicate?.(i.source)).length
    return {
      workspaceModels: count(props.models, (s) => layerTag(s) === 'workspace'),
      userModels: count(props.models, (s) => layerTag(s) === 'user'),
      workspaceAliases: count(props.aliases, (s) => layerTag(s) === 'workspace'),
      userAliases: count(props.aliases, (s) => layerTag(s) === 'user'),
      mergedModels: new Set(props.models.map((m) => m.modelName)).size,
      mergedAliases: new Set(props.aliases.map((a) => a.alias)).size,
    }
  }, [props.models, props.aliases])

  const createSpace: 'workspace' | 'user' = space === 'user' ? 'user' : 'workspace'
  const addLabel = mode === 'alias' ? '新建别名' : '新建模型条目'

  return (
    <section
      ref={pageRef}
      className={`models-page${pane.overlay ? ' editor-overlay' : ''}${detailOpen ? '' : ' detail-closed'}`}
      aria-label="模型关联"
    >
      <div className="models-body" style={{ '--models-list-w': `${pane.listWidth}px` } as CSSProperties}>
        <ListPane
          listRef={listRef}
          className="models-list"
          title="模型关联"
          count={`${rows.length}/${allRows.length}`}
          headAction={
            <div className="list-head-actions">
              <div className="seg-switch" role="group" aria-label="registry 空间">
                {SPACES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={space === s.id ? 'active' : ''}
                    aria-pressed={space === s.id}
                    title={s.title}
                    onClick={() => setSpace(s.id)}
                  >{s.label}</button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm model-add"
                title={`${addLabel}（${createSpace === 'workspace' ? '工作区层' : '用户层'}）`}
                aria-label={addLabel}
                onClick={() => (mode === 'alias' ? props.onAddAlias(createSpace) : props.onAddModel(createSpace))}
              >＋<span className="model-add-label">新建</span></button>
            </div>
          }
          tools={
            <>
              <input
                className="input list-search"
                type="search"
                value={text}
                placeholder={mode === 'alias' ? '搜索别名 / 目标 / 使用方' : '搜索模型 / provider / 别名 / agent'}
                aria-label={mode === 'alias' ? '搜索别名' : '搜索模型条目'}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="list-filter-row">
                <select
                  className="select list-filter"
                  value={mode}
                  aria-label="条目类别"
                  onChange={(e) => setMode(e.target.value as RegistryKind)}
                >
                  <option value="alias">别名</option>
                  <option value="model">模型条目</option>
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
                  className={`btn btn-sm${onlyProblems ? ' btn-primary' : ''}`}
                  aria-pressed={onlyProblems}
                  title={mode === 'alias' ? '只看悬空或目标停用的别名' : '只看 available:false 的模型条目'}
                  onClick={() => setOnlyProblems((v) => !v)}
                >仅异常</button>
              </div>
            </>
          }
          bodyRole="listbox"
          bodyLabel="别名与模型条目列表"
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
          {mode === 'alias'
            ? aliasRows.map((row) => {
              const selected = row.key === selectedKey
              const lower = row.layers.filter((l) => l.source !== row.record.source).length
              return (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-model-row={row.key}
                  className={`model-row${selected ? ' selected' : ''}`}
                  onClick={() => selectRow(row.key)}
                >
                  <span className="model-row-main">
                    <span className="model-row-name" title={row.name}>{row.name}</span>
                    <span className="model-row-arrow">→</span>
                    <span className="model-row-target" title={row.record.targets.join(', ')}>
                      {row.record.targets[0] ?? '（未声明目标）'}
                    </span>
                    <span className={`model-ref-count${row.users.length === 0 ? ' none' : ''}`}>
                      {row.users.length === 0 ? '未使用' : `Agent ×${row.users.length}`}
                    </span>
                  </span>
                  <span className="model-row-sub">
                    <span className={`tag tag-${layerTag(row.record.source)}`}>{layerLabel(row.record.source)}</span>
                    {!row.target && <span className="tag tag-err">悬空</span>}
                    {row.target && !row.target.available && <span className="tag tag-warn">目标停用</span>}
                    {space === 'merged' && row.layers.length > 1 && <span className="tag tag-warn">遮蔽 {row.layers.length - 1}</span>}
                    {space === 'user' && row.winner.source !== row.record.source && <span className="tag tag-warn">被覆盖</span>}
                    {space === 'workspace' && lower > 0 && <span className="tag tag-ok">覆盖 {lower}</span>}
                    <span className="section-path" title={row.record.path}>
                      <span className="section-path-text">{row.record.path ?? '（内置，无文件）'}</span>
                    </span>
                  </span>
                </button>
              )
            })
            : modelRows.map((row) => {
              const selected = row.key === selectedKey
              const lower = row.layers.filter((l) => l.source !== row.record.source).length
              return (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-model-row={row.key}
                  className={`model-row${selected ? ' selected' : ''}`}
                  onClick={() => selectRow(row.key)}
                >
                  <span className="model-row-main">
                    <span className="model-row-name" title={row.name}>{row.name}</span>
                    <span className="model-row-target" title={`${row.record.provider}/${row.record.model}`}>
                      {row.record.provider}/{row.record.model}
                    </span>
                    <span className={`model-ref-count${row.aliases.length === 0 ? ' none' : ''}`}>
                      {row.aliases.length === 0 ? '无别名' : `别名 ×${row.aliases.length}`}
                    </span>
                  </span>
                  <span className="model-row-sub">
                    <span className={`tag tag-${layerTag(row.record.source)}`}>{layerLabel(row.record.source)}</span>
                    {!row.record.available && <span className="tag tag-warn">停用</span>}
                    {space === 'merged' && row.layers.length > 1 && <span className="tag tag-warn">遮蔽 {row.layers.length - 1}</span>}
                    {space === 'user' && row.winner.source !== row.record.source && <span className="tag tag-warn">被覆盖</span>}
                    {space === 'workspace' && lower > 0 && <span className="tag tag-ok">覆盖 {lower}</span>}
                    <span className="section-path" title={row.record.path}>
                      <span className="section-path-text">{row.record.path ?? '（无文件）'}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          {rows.length === 0 && (
            <div className="list-empty">
              <div className="section-empty-title">没有匹配的{mode === 'alias' ? '别名' : '模型条目'}</div>
              <div>换关键词，或清除当前筛选</div>
              <button type="button" className="btn btn-sm" onClick={resetFilters}>清除筛选</button>
            </div>
          )}
        </ListPane>

        <PaneSplitter
          className="models-splitter"
          label={`调整列表宽度（列表最小 ${PANE_LIST_MIN_REM}rem，详情最小 ${PANE_CONTENT_MIN_REM}rem）`}
          value={pane.listWidth}
          min={pane.minList}
          max={pane.maxListWidth}
          onResize={pane.setListWidth}
          onReset={pane.resetListWidth}
        />

        <div className="model-detail">
          {active ? (
            <>
              <div className="model-detail-head">
                <button type="button" className="btn btn-sm model-back" onClick={() => setDetailOpen(false)}>← 返回</button>
                <span className="model-detail-name" title={activeName ?? ''}>{activeName}</span>
                <span className={`tag tag-${layerTag(active.record.source)}`}>{layerLabel(active.record.source)}</span>
                {'builtin' in active.record && active.record.builtin && <span className="tag tag-bundled">内置 · 只读</span>}
                {activeLayerNote && <span className="tag tag-warn">{activeLayerNote}</span>}
                <span className="model-detail-fill" />
                <button
                  type="button"
                  className="btn btn-sm"
                  title={mode === 'alias' ? '复制别名（用于 modelOrder）' : '复制模型条目名（用于 alias.targets）'}
                  onClick={() => copyName(activeName ?? '')}
                >{copied ? '已复制' : mode === 'alias' ? '复制别名' : '复制条目名'}</button>
                {('builtin' in active.record && active.record.builtin) ? null : (() => {
                  const canDelete = mode === 'alias'
                    ? (activeAlias ? activeAlias.layers.length > 1 || activeAlias.users.length === 0 : false)
                    : (activeModel ? activeModel.layers.length > 1 || activeModel.aliases.length === 0 : false)
                  if (canDelete) {
                    const fallback = mode === 'alias'
                      ? activeAlias?.layers.filter((l) => l.source !== activeAlias.record.source).map((l) => layerLabel(l.source)).join('、')
                      : activeModel?.layers.filter((l) => l.source !== activeModel.record.source).map((l) => layerLabel(l.source)).join('、')
                    return (
                      <button
                        type="button"
                        className="btn btn-sm section-delete"
                        title={fallback ? `删除后由 ${fallback} 同名条目接管` : '删除该条 registry 记录'}
                        onClick={() => {
                          if (mode === 'alias' && activeAlias) props.onDeleteAlias(activeAlias.record.source, activeAlias.name)
                          if (mode === 'model' && activeModel) props.onDeleteModel(activeModel.record.source, activeModel.name)
                        }}
                      >删除</button>
                    )
                  }
                  return (
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
                          <div className="menu menu-right section-refs-menu" role="menu" aria-label={`${activeName} 的引用列表`}>
                            {mode === 'alias' && activeAlias && (
                              <>
                                <div className="section-refs-head">Agent 引用 · {activeAlias.users.length}</div>
                                {activeAlias.users.map((user) => (
                                  <button
                                    key={user}
                                    type="button"
                                    role="menuitem"
                                    className="menu-item"
                                    onClick={() => {
                                      setRefsOpen(false)
                                      props.onOpenAgent(user)
                                    }}
                                  >
                                    <span className="mono">{user}</span>
                                    <span className="section-refs-hint">打开</span>
                                  </button>
                                ))}
                              </>
                            )}
                            {mode === 'model' && activeModel && (
                              <>
                                <div className="section-refs-head">被别名指向 · {activeModel.aliases.length}</div>
                                {activeModel.aliases.map((al) => (
                                  <button
                                    key={`${al.source}:${al.alias}`}
                                    type="button"
                                    role="menuitem"
                                    className="menu-item"
                                    onClick={() => {
                                      setRefsOpen(false)
                                      openAliasByName(al.alias)
                                    }}
                                  >
                                    <span className="mono">{al.alias}</span>
                                    <span className="section-refs-hint">{layerLabel(al.source)}</span>
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </span>
                  )
                })()}
                <button
                  type="button"
                  className="btn-icon model-close"
                  onClick={() => setDetailOpen(false)}
                  title="关闭详情"
                  aria-label="关闭详情"
                >×</button>
              </div>

              <div className="model-detail-body">
                {mode === 'alias' && activeAlias && (
                  <AliasDetail
                    row={activeAlias}
                    models={props.models}
                    aliases={props.aliases}
                    onRemap={props.onRemap}
                    onOpenAgent={props.onOpenAgent}
                    onOpenAlias={openAliasByName}
                  />
                )}
                {mode === 'model' && activeModel && (
                  <ModelDetail
                    row={activeModel}
                    agents={props.agents}
                    onSetAvailable={props.onSetAvailable}
                    onOpenAlias={openAliasByName}
                    onOpenAgent={props.onOpenAgent}
                    onOpenPrompt={props.onOpenPrompt}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="sections-empty">
              <div className="section-empty-title">未选择条目</div>
              <div>在左侧选择别名或模型条目，查看解析、层覆盖与引用关系</div>
              <div className="model-empty-summary">
                合并后 {summary.mergedModels} 个模型 / {summary.mergedAliases} 个别名 · 工作区 {summary.workspaceModels} / {summary.workspaceAliases} · 用户 {summary.userModels} / {summary.userAliases}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/* ── 别名详情：解析目标、重映射、使用者、同指向 ─────────────────── */

interface AliasDetailProps {
  row: AliasRow
  models: ModelDef[]
  aliases: AliasDef[]
  onRemap: (source: AgentSource, alias: string, target: string) => void
  onOpenAgent: (agentName: string) => void
  onOpenAlias: (aliasName: string) => void
}

function AliasDetail(props: AliasDetailProps) {
  const { row } = props
  const targetName = row.record.targets[0] ?? ''
  const modelNames = [...new Set(props.models.map((m) => m.modelName))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  // 同指向 = 解析后仍指向同一目标的其它生效别名（被覆盖层不算）。
  const siblings = aliasesPointingAt(targetName, props.aliases)
    .filter((a) => a.alias !== row.name)
    .sort((a, b) => a.alias.localeCompare(b.alias, 'zh-CN'))
  const note = shadowNote(row.record, row.winner, row.layers)
  const shadowed = row.winner.source !== row.record.source

  return (
    <>
      <section className="model-block">
        <div className="model-block-head">
          解析目标
          <span className="dim">S5 · 改目标 = 注入名不变</span>
        </div>
        <div className={`model-target${row.target ? '' : ' broken'}`}>
          <div className="model-target-main">
            <span className="model-target-name">{targetName || '（未声明目标）'}</span>
            {row.target
              ? <span className="model-target-id">{row.target.provider}/{row.target.model}</span>
              : <span className="err-text">目标不存在（unknown-model-target）</span>}
          </div>
          {row.target && <span className={`tag tag-${layerTag(row.target.source)}`}>{layerLabel(row.target.source)}</span>}
          {row.target && !row.target.available && <span className="tag tag-warn">available:false · 解析时跳过</span>}
        </div>
        {!row.record.builtin && (
          <div className="model-remap">
            <span className="dim">重映射</span>
            <select
              className="select"
              value={targetName}
              aria-label="重映射目标"
              onChange={(e) => props.onRemap(row.record.source, row.name, e.target.value)}
            >
              {!row.target && targetName && <option value={targetName}>{targetName}（不存在）</option>}
              {modelNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <span className="model-remap-impact">
              影响 Agent ×{row.users.length}
              {row.users.length > 0 ? `：${row.users.join('、')}` : '（无使用者）'}
              {shadowed ? ` · 本条被 ${layerLabel(row.winner.source)} 覆盖，当前解析不变` : ''}
            </span>
          </div>
        )}
      </section>

      <dl className="section-meta">
        <div className="section-meta-file">
          <dt>文件</dt>
          <dd className="mono">{row.record.path ?? '（内置，无文件）'}</dd>
        </div>
        <div>
          <dt>空间</dt>
          <dd>{layerLabel(row.record.source)}{row.record.builtin ? ' · 只读' : ''}</dd>
        </div>
        <div>
          <dt>指向</dt>
          <dd className="mono">{targetName || '—'}</dd>
        </div>
        <div>
          <dt>使用者</dt>
          <dd>Agent ×{row.users.length}</dd>
        </div>
        {note && (
          <div className="section-meta-grow">
            <dt>层关系</dt>
            <dd>{note}</dd>
          </div>
        )}
      </dl>

      <section className="model-assoc">
        <div className="model-assoc-head">使用者 <span className="model-assoc-count">Agent ×{row.users.length}</span></div>
        {row.users.length > 0 ? (
          <div className="model-chips">
            {row.users.map((user) => (
              <button key={user} type="button" className="model-chip" onClick={() => props.onOpenAgent(user)}>
                <span>{user}</span>
                <span className="model-chip-hint">打开 ↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="model-note">无 agent 使用此别名 · 可安全删除</div>
        )}
        {row.users.length > 0 && shadowed && (
          <div className="model-note">本条被 {layerLabel(row.winner.source)} 同名别名覆盖；上方 agent 实际命中覆盖层。</div>
        )}
      </section>

      {siblings.length > 0 && (
        <section className="model-assoc">
          <div className="model-assoc-head">同指向 <span className="model-assoc-count">别名 ×{siblings.length}</span></div>
          <div className="model-chips">
            {siblings.map((al) => (
              <button
                key={`${al.source}:${al.alias}`}
                type="button"
                className="model-chip"
                title={`${layerLabel(al.source)} · → ${al.targets[0] ?? '?'}`}
                onClick={() => props.onOpenAlias(al.alias)}
              >
                <span>{al.alias}</span>
                <span className={`tag tag-${layerTag(al.source)}`}>{layerLabel(al.source)}</span>
              </button>
            ))}
          </div>
          <div className="model-note">多对一无害，但意图重叠（alias-fan-in hint）；点击可切换查看。</div>
        </section>
      )}
    </>
  )
}

/* ── 模型条目详情：可用性、被别名指向、触达 agent、系统提示词 ───── */

interface ModelDetailProps {
  row: ModelRow
  agents: AgentDoc[]
  onSetAvailable: (source: AgentSource, modelName: string, available: boolean) => void
  onOpenAlias: (aliasName: string) => void
  onOpenAgent: (agentName: string) => void
  onOpenPrompt: (modelName: string) => void
}

function ModelDetail(props: ModelDetailProps) {
  const { row } = props
  const prompt = row.record.sysPrompt ?? ''
  const note = shadowNote(row.record, row.winner, row.layers)
  const shadowsEffective = row.winner.source !== row.record.source

  return (
    <>
      <section className="model-block">
        <div className="model-block-head">
          模型条目
          <span className="dim">available = 解析时是否参与命中</span>
        </div>
        <div className="model-target">
          <div className="model-target-main">
            <span className="model-target-name">{row.name}</span>
            <span className="model-target-id">{row.record.provider}/{row.record.model}</span>
          </div>
          <span className="model-target-spacer" />
          <span className={`tag ${row.record.available ? 'tag-ok' : 'tag-warn'}`}>
            {row.record.available ? 'available' : 'available:false'}
          </span>
          <label className="toggle" title="available:false = 解析时跳过（沿 modelOrder 回退）">
            <input
              type="checkbox"
              checked={row.record.available}
              aria-label={`${row.name} available`}
              onChange={() => props.onSetAvailable(row.record.source, row.name, !row.record.available)}
            />
            <span className="toggle-track" />
          </label>
        </div>
        <div className="model-note">
          {shadowsEffective
            ? `本条被 ${layerLabel(row.winner.source)} 同名条目覆盖，实际解析使用覆盖层。`
            : row.record.available
              ? '参与解析：别名命中此条目时直接采用。'
              : '不参与解析：链上的别名命中后被跳过，继续沿 modelOrder 回退。'}
        </div>
      </section>

      <dl className="section-meta">
        <div className="section-meta-file">
          <dt>文件</dt>
          <dd className="mono">{row.record.path ?? '（无文件）'}</dd>
        </div>
        <div>
          <dt>空间</dt>
          <dd>{layerLabel(row.record.source)}</dd>
        </div>
        <div>
          <dt>别名</dt>
          <dd>Alias ×{row.aliases.length}</dd>
        </div>
        <div>
          <dt>触达 agent</dt>
          <dd>Agent ×{row.reach.length}</dd>
        </div>
        <div>
          <dt>系统提示词</dt>
          <dd>{prompt ? `${prompt.length} 字` : '未调优'}</dd>
        </div>
        {note && (
          <div className="section-meta-grow">
            <dt>层关系</dt>
            <dd>
              {note}
              {shadowsEffective && ' · 本条目不生效'}
            </dd>
          </div>
        )}
      </dl>

      <section className="model-assoc">
        <div className="model-assoc-head">被别名指向 <span className="model-assoc-count">Alias ×{row.aliases.length}</span></div>
        {row.aliases.length > 0 ? (
          <div className="model-chips">
            {row.aliases.map((al) => (
              <button
                key={`${al.source}:${al.alias}`}
                type="button"
                className="model-chip"
                title={`${layerLabel(al.source)} · Agent ×${agentsUsingAlias(al.alias, props.agents).length}`}
                onClick={() => props.onOpenAlias(al.alias)}
              >
                <span>{al.alias}</span>
                <span className={`tag tag-${layerTag(al.source)}`}>{layerLabel(al.source)}</span>
                <span className="model-chip-hint">Agent ×{agentsUsingAlias(al.alias, props.agents).length}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="model-note">无别名指向此条目 · 可安全删除</div>
        )}
      </section>

      <section className="model-assoc">
        <div className="model-assoc-head">触达 agent <span className="model-assoc-count">Agent ×{row.reach.length}</span></div>
        {row.reach.length > 0 ? (
          <div className="model-chips">
            {row.reach.map((r) => (
              <button key={r.agent} type="button" className="model-chip" onClick={() => props.onOpenAgent(r.agent)}>
                <span>{r.agent}</span>
                <span className="model-chip-hint">via {r.via.join(' / ')} ↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="model-note">没有 agent 的 modelOrder 经别名到达此条目。</div>
        )}
      </section>

      <section className="model-block model-prompt">
        <div className="model-block-head">
          系统提示词
          <span className="dim">{prompt ? `${prompt.length} 字` : '未调优'}</span>
          <span className="model-detail-fill" />
          <button
            type="button"
            className="btn btn-sm"
            title={shadowsEffective ? '本条目不生效；将打开工作区生效条目的提示词' : '在系统提示词页编辑'}
            onClick={() => props.onOpenPrompt(row.name)}
          >编辑 →</button>
        </div>
        <pre className="model-prompt-preview">{prompt || '（无 sysPrompt —— 未调优）'}</pre>
        {shadowsEffective && (
          <div className="model-note">本条目不生效；「编辑」将打开 {layerLabel(row.winner.source)} 的生效条目。</div>
        )}
      </section>
    </>
  )
}
