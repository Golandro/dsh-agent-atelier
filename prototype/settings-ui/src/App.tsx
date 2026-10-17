/**
 * PROTOTYPE — 应用装配：全部状态在内存（刷新即重置），tab/变体同步进 URL（可分享）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AgentDoc, AgentSource, FileWrite, PromptClip } from './types'
import { AGENTS, ALIASES, CLIPS, KNOWN_SKILLS, KNOWN_TOOLS, MODELS, WORKSPACES, CHANNEL_TABLE } from './fixtures'
import { composeDocument, inspectAll, layerLabel, remapImpact, resolveAlias, resolveModel, saveWrites } from './model'
import { TopBar } from './components/TopBar'
import { Tabs } from './components/Tabs'
import { AgentList } from './components/AgentList'
import { AgentEditor } from './components/AgentEditor'
import { ClipLibrary } from './components/ClipLibrary'
import { ModelLinks } from './components/ModelLinks'
import type { ModelLinkFocus } from './components/ModelLinks'
import { PaneSplitter } from './components/PaneSplitter'
import { SystemPrompts } from './components/SystemPrompts'
import { AdvisorPanel } from './components/AdvisorPanel'
import { Inspector } from './components/Inspector'
import type { InspectorFile, LogEntry } from './components/Inspector'
import { VariantBar } from './components/VariantBar'
import { PANE_CONTENT_MIN_REM, PANE_LIST_MIN_REM, paneSplitThreshold, usePaneLayout } from './pane-layout'

export type Tab = 'agents' | 'sections' | 'models' | 'prompts' | 'advisor'
export type AdvisorVariant = 'drawer' | 'tab'

const readUrl = () => {
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('tab')
  const advisor = q.get('advisor')
  return {
    tab: (['agents', 'sections', 'models', 'prompts', 'advisor'].includes(tab ?? '') ? tab : 'agents') as Tab,
    advisor: (advisor === 'tab' ? 'tab' : 'drawer') as AdvisorVariant,
  }
}

let seq = 1
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/** 无已保存覆盖时的稳定空对象（避免 useMemo 每次失效）。 */
const EMPTY_BLOCK_OVERRIDES: Record<string, string> = {}

export default function App() {
  const [initial] = useState(readUrl)
  const [tab, setTab] = useState<Tab>(initial.tab)
  const [variant, setVariant] = useState<AdvisorVariant>(initial.advisor)
  const [workspace, setWorkspace] = useState(WORKSPACES[0]!)

  const [agents, setAgents] = useState<AgentDoc[]>(AGENTS)
  const [clips, setClips] = useState<PromptClip[]>(CLIPS)
  const [focusClip, setFocusClip] = useState<string | null>(null)
  const [models, setModels] = useState(MODELS)
  const [aliases, setAliases] = useState(ALIASES)
  const [focusModelLink, setFocusModelLink] = useState<ModelLinkFocus | null>(null)
  const [focusModelName, setFocusModelName] = useState<string | null>(null)

  const [selectedAgent, setSelectedAgent] = useState('code-reviewer')
  const pageRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  // 放得下（列表 20rem + 编辑器 40rem + 分隔条）默认并列；否则默认先看列表，
  // 选中 agent 时编辑器以浮层覆盖列表。
  const [editorOpen, setEditorOpen] = useState(() => window.innerWidth >= paneSplitThreshold())
  const [compact, setCompact] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  /** 已保存的块文本（模拟磁盘）：front-matter/prose 属 agent，clip 文件全局共享 */
  const [agentOverrides, setAgentOverrides] = useState<Record<string, Record<string, string>>>({})
  const [clipOverrides, setClipOverrides] = useState<Record<string, string>>({})
  const [savedFiles, setSavedFiles] = useState<string[]>([])

  const [advisorOpen, setAdvisorOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [lastWrites, setLastWrites] = useState<FileWrite[]>([])
  const [log, setLog] = useState<LogEntry[]>([])

  // 与 Prompt Sections 共用同一套分栏度量：可用宽度扣除顾问抽屉后，
  // 放不下「列表最小 + 内容最小 + 分隔条」时内容区改为浮层。
  const pane = usePaneLayout(pageRef, {
    excludeRef: drawerRef,
    excludeActive: variant === 'drawer' && advisorOpen,
    measureKey: tab,
  })

  useEffect(() => {
    const q = new URLSearchParams()
    if (tab !== 'agents') q.set('tab', tab)
    if (variant !== 'drawer') q.set('advisor', variant)
    window.history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}`)
  }, [tab, variant])

  const pushLog = (text: string) => setLog((l) => [...l, { time: stamp(), text }])
  const markWrites = (writes: FileWrite[]) => {
    setLastWrites(writes)
    setSavedFiles((f) => [...new Set([...f, ...writes.map((w) => w.file)])])
  }

  const agent = agents.find((a) => a.agentName === selectedAgent) ?? agents[0]!
  const currentAgentOverrides = agentOverrides[agent.agentName] ?? EMPTY_BLOCK_OVERRIDES
  const docOverrides = useMemo(
    () => ({ ...clipOverrides, ...currentAgentOverrides }),
    [clipOverrides, currentAgentOverrides],
  )
  const doc = useMemo(() => composeDocument(agent, clips, { overrides: docOverrides }), [agent, clips, docOverrides])
  const findings = useMemo(() => inspectAll(agents, models, aliases, KNOWN_TOOLS, KNOWN_SKILLS), [agents, models, aliases])

  /* ── Agents 页 ── */
  const selectAgent = (name: string, jumpTab = false) => {
    if (Object.keys(drafts).length > 0 && name !== selectedAgent) pushLog('切换 agent：未保存改动已丢弃')
    setSelectedAgent(name)
    setDrafts({})
    setEditorOpen(true)
    if (jumpTab) setTab('agents')
  }

  /** 单编辑器回传整篇文本；文本回到已保存值的块自动视为干净（不产生空保存）。 */
  const applyEditorDrafts = (texts: Record<string, string>) => {
    setDrafts(() => {
      const next: Record<string, string> = {}
      for (const block of doc.blocks) {
        const text = texts[block.id]
        if (text !== undefined && text !== block.text) next[block.id] = text
      }
      return next
    })
  }
  /** 可保存全部脏块，也可只传一个块（分块保存）。 */
  const saveBlocks = (blockIds: string[]) => {
    const only: Record<string, string> = {}
    for (const id of blockIds) {
      const text = drafts[id]
      if (text !== undefined) only[id] = text
    }
    const writes = saveWrites(doc, only)
    const ids = Object.keys(only)
    if (writes.length === 0 || ids.length === 0) return
    const clipDrafts: Record<string, string> = {}
    const agentDrafts: Record<string, string> = {}
    for (const id of ids) {
      const block = doc.blocks.find((b) => b.id === id)
      if (!block) continue
      if (block.kind === 'clip') clipDrafts[id] = only[id]!
      else agentDrafts[id] = only[id]!
    }
    if (Object.keys(clipDrafts).length > 0) setClipOverrides((o) => ({ ...o, ...clipDrafts }))
    if (Object.keys(agentDrafts).length > 0) {
      setAgentOverrides((o) => ({
        ...o,
        [agent.agentName]: { ...(o[agent.agentName] ?? {}), ...agentDrafts },
      }))
    }
    setDrafts((d) => {
      const next = { ...d }
      for (const id of ids) delete next[id]
      return next
    })
    markWrites(writes)
    pushLog(
      ids.length === 1
        ? `保存块 ${ids[0]} → ${writes[0]!.file}`
        : `保存 ${ids.length} 个块 → ${writes.length} 个文件 — ${writes.map((w) => w.file).join('、')}`,
    )
    setInspectorOpen(true)
  }
  const saveAll = () => saveBlocks(Object.keys(drafts))
  const revertBlock = (blockId: string) => {
    setDrafts((d) => {
      const { [blockId]: _, ...rest } = d
      return rest
    })
    pushLog(`回退块 ${blockId}（恢复为上次保存内容）`)
  }
  const revertAll = () => {
    setDrafts({})
    pushLog('回退所有未保存改动')
  }

  /* ── 新建 ── */
  const addAgent = (kind: 'blank' | 'reviewer' | 'researcher') => {
    const base = kind === 'reviewer' ? agents.find((a) => a.agentName === 'code-reviewer') : kind === 'researcher' ? agents.find((a) => a.agentName === 'researcher') : undefined
    const name = `new-agent-${seq++}`
    const fresh: AgentDoc = base
      ? { ...base, agentName: name, frontmatter: { ...base.frontmatter, name: `${base.frontmatter.name ?? base.agentName} 副本` }, extra: { ...base.extra }, source: 'project-dsh', origin: 'user', path: `.dsh/agents/${name}/${name}.agent.md` }
      : { agentName: name, frontmatter: { description: '', modelOrder: ['dsh-default'] }, extra: {}, body: '（在此写 persona 正文；用 `{% include clip 切片名 %}` 行引用切片）', source: 'project-dsh', origin: 'user', path: `.dsh/agents/${name}/${name}.agent.md` }
    setAgents((a) => [...a, fresh])
    markWrites([{ file: fresh.path, reason: '新建 agent', lines: fresh.body.split('\n').length }])
    pushLog(`新建 ${fresh.path}`)
    selectAgent(name)
    setTab('agents')
  }
  const addClip = () => {
    const name = `new-section-${seq++}`
    const clip: PromptClip = { name, file: `.dsh/agents/sections/${name}.md`, source: 'project-dsh', content: '## 新切片\n' }
    setClips((c) => [...c, clip])
    markWrites([{ file: clip.file, reason: '新建切片', lines: 1 }])
    pushLog(`新建 ${clip.file}；在 agent 正文用 \`{% include clip ${name} %}\` 行引用`)
    setFocusClip(name)
    setTab('sections')
  }

  /* ── 切片库 ── */
  const renameClip = (name: string) => {
    const next = window.prompt('新切片名（= 新文件名；引用方需同步改 `$ 行`）', name)
    if (!next || next === name) return
    setClips((cs) => cs.map((c) => (c.name === name ? { ...c, name: next, file: c.file.replace(`${name}.md`, `${next}.md`) } : c)))
    pushLog(`重命名切片 ${name} → ${next}（演示：引用方的 \`$ ${name}\` 行未自动改写，会产生悬空引用）`)
  }
  const deleteClip = (name: string) => {
    if (!window.confirm(`删除切片 ${name} 的所有层文件？`)) return
    setClips((cs) => cs.filter((c) => c.name !== name))
    pushLog(`删除切片 ${name}`)
  }

  /* ── 模型关联 / 系统提示词（registry.yaml 读写）── */
  const registryWrite = (path: string, reason: string): FileWrite => ({ file: path, reason, lines: 1 })
  const registryPath = (source: AgentSource) =>
    source.startsWith('project') ? '.dsh/agents/registry.yaml' : '~/.dsh/agents/registry.yaml'

  /** available 按「层 + 名」定位：同名模型条目可以在两层各有一条。 */
  const toggleAvailable = (source: AgentSource, modelName: string, available: boolean) => {
    const m = models.find((x) => x.source === source && x.modelName === modelName)
    if (!m) return
    setModels((ms) => ms.map((x) => (x.source === source && x.modelName === modelName ? { ...x, available } : x)))
    markWrites([registryWrite(m.path ?? registryPath(source), `available → ${available}`)])
    pushLog(`${modelName} @ ${layerLabel(source)} available → ${available}（解析时${available ? '恢复命中' : '跳过并回退'}；写回 ${m.path ?? 'registry.yaml'}）`)
  }
  const saveSysPrompt = (source: AgentSource, modelName: string, text: string) => {
    const m = models.find((x) => x.source === source && x.modelName === modelName)
    setModels((ms) => ms.map((x) => (x.source === source && x.modelName === modelName ? { ...x, sysPrompt: text } : x)))
    markWrites([registryWrite(m?.path ?? registryPath(source), `sysPrompt 写回 ${modelName}`)])
    pushLog(`保存 ${modelName} @ ${layerLabel(source)} 的 sysPrompt（per-model 提示词，D6）`)
  }
  /** 顾问面板：重映射解析后的生效别名。 */
  const remapAlias = (alias: string, target: string) => {
    const current = resolveAlias(alias, aliases)
    if (!current) return
    const impact = remapImpact(alias, target, agents, models, aliases)
    setAliases((as) => as.map((a) => (a === current ? { ...a, targets: [target] } : a)))
    markWrites([registryWrite(current.path ?? 'registry.yaml', `S5 重映射 ${alias}`)])
    pushLog(`S5：${alias} 注入名不变；命中 ${impact.before?.modelName ?? '（无）'} → ${target}；受影响 agent：${impact.affectedAgents.join('、') || '无'}`)
  }
  /** 模型关联页：重映射指定层的那条记录（被遮蔽的 user 层也能单独改）。 */
  const remapAliasAt = (source: AgentSource, alias: string, target: string) => {
    const current = aliases.find((a) => a.alias === alias && a.source === source)
    if (!current) return
    const impact = remapImpact(alias, target, agents, models, aliases, source)
    setAliases((as) => as.map((a) => (a === current ? { ...a, targets: [target] } : a)))
    markWrites([registryWrite(current.path ?? registryPath(source), `S5 重映射 ${alias}`)])
    pushLog(`S5：${alias}（${layerLabel(source)}）注入名不变；命中 ${impact.before?.modelName ?? '（无）'} → ${target}；受影响 agent：${impact.affectedAgents.join('、') || '无'}`)
  }

  const addModel = (space: 'workspace' | 'user') => {
    const source: AgentSource = space === 'workspace' ? 'project-dsh' : 'user-dsh'
    const path = registryPath(source)
    const modelName = `new-model-${seq++}`
    setModels((ms) => [...ms, { modelName, provider: 'deepseek', model: `custom-${modelName}`, available: true, source, path, sysPrompt: '' }])
    markWrites([registryWrite(path, `新建模型条目 ${modelName}`)])
    pushLog(`新建模型条目 ${modelName} → ${path}`)
    setFocusModelLink({ kind: 'model', name: modelName, source })
  }
  const addAlias = (space: 'workspace' | 'user') => {
    const source: AgentSource = space === 'workspace' ? 'project-dsh' : 'user-dsh'
    const path = registryPath(source)
    const target = [...new Set(models.map((m) => m.modelName))]
      .map((name) => resolveModel(name, models))
      .find((m) => m?.available)?.modelName ?? 'dsh-default'
    const alias = `new-alias-${seq++}`
    setAliases((as) => [...as, { alias, targets: [target], source, path }])
    markWrites([registryWrite(path, `新建别名 ${alias}`)])
    pushLog(`新建别名 ${alias} → ${target}（${path}）`)
    setFocusModelLink({ kind: 'alias', name: alias, source })
  }
  const deleteAlias = (source: AgentSource, alias: string) => {
    const target = aliases.find((a) => a.alias === alias && a.source === source)
    if (!target) return
    if (!window.confirm(`删除别名 ${alias}（${layerLabel(source)}）？`)) return
    const rest = aliases.filter((a) => !(a.alias === alias && a.source === source))
    const fallback = resolveAlias(alias, rest)
    setAliases(rest)
    markWrites([registryWrite(target.path ?? registryPath(source), `删除别名 ${alias}`)])
    pushLog(fallback
      ? `删除别名 ${alias}（${layerLabel(source)}）；同名 ${layerLabel(fallback.source)} 别名接管`
      : `删除别名 ${alias}（${layerLabel(source)}）`)
  }
  const deleteModel = (source: AgentSource, modelName: string) => {
    const target = models.find((m) => m.source === source && m.modelName === modelName)
    if (!target) return
    if (!window.confirm(`删除模型条目 ${modelName}（${layerLabel(source)}）？`)) return
    const rest = models.filter((m) => !(m.source === source && m.modelName === modelName))
    const fallback = resolveModel(modelName, rest)
    setModels(rest)
    markWrites([registryWrite(target.path ?? registryPath(source), `删除模型条目 ${modelName}`)])
    pushLog(fallback
      ? `删除模型条目 ${modelName}（${layerLabel(source)}）；同名 ${layerLabel(fallback.source)} 条目接管`
      : `删除模型条目 ${modelName}（${layerLabel(source)}）`)
  }

  /* ── Edit Tools ── */
  const invalidate = () => pushLog('invalidate() → 重读 agent/别名/模型目录（D24：无 watcher，显式失效；digest 门控不变不发）')
  const externalEdit = () => {
    const id = 'clip-review-checklist'
    const cur = clipOverrides[id] ?? clips.find((c) => c.name === 'review-checklist' && c.source === 'project-dsh')?.content
    if (!cur) return
    const text = `${cur}\n- [ ] （外部手改新增的一行）`
    setClipOverrides((o) => ({ ...o, [id]: text }))
    markWrites([{ file: '.dsh/agents/sections/review-checklist.md', reason: '外部手改（演示）', lines: 1 }])
    pushLog('模拟外部手改 review-checklist.md → invalidate 重读后 UI 反映（演示即时反映）')
  }

  /* ── Inspector 文件清单 ── */
  const files: InspectorFile[] = useMemo(() => {
    const regPaths = [...new Set([...models.map((m) => m.path), ...aliases.map((a) => a.path)].filter((p): p is string => !!p))]
    return [
      ...agents.map((a) => ({ path: a.path, kind: 'agent' as const, modified: savedFiles.includes(a.path) })),
      ...clips.map((c) => ({ path: c.file, kind: 'section' as const, modified: savedFiles.includes(c.file) })),
      ...regPaths.map((p) => ({ path: p, kind: 'registry' as const, modified: savedFiles.includes(p) })),
    ]
  }, [agents, clips, models, aliases, savedFiles])

  return (
    <div className="app">
      <TopBar workspace={workspace} workspaces={WORKSPACES} onWorkspace={(w) => { setWorkspace(w); pushLog(`切换 workspace → ${w}（演示：项目层发现根重扫）`) }} onAddAgent={addAgent} onAddClip={addClip} />
      <Tabs
        tab={tab}
        onTab={setTab}
        showAdvisorTab={variant === 'tab'}
        advisorOpen={advisorOpen}
        onToggleAdvisor={() => (variant === 'tab' ? setTab('advisor') : setAdvisorOpen((v) => !v))}
        onInvalidate={invalidate}
        onExternalEdit={externalEdit}
      />
      <main className="page">
        {tab === 'agents' && (
          <div
            ref={pageRef}
            className={`agents-page${variant === 'drawer' && advisorOpen ? ' with-drawer' : ''}${editorOpen ? '' : ' editor-closed'}${editorOpen && pane.overlay ? ' editor-overlay' : ''}`}
            style={{ '--list-width': `${pane.listWidth}px` } as CSSProperties}
          >
            <AgentList agents={agents} findings={findings} selected={agent.agentName} onSelect={selectAgent} />
            {editorOpen && (
              <>
                <PaneSplitter
                  label={`调整列表宽度（列表最小 ${PANE_LIST_MIN_REM}rem，编辑器最小 ${PANE_CONTENT_MIN_REM}rem）`}
                  value={pane.listWidth}
                  min={pane.minList}
                  max={pane.maxListWidth}
                  onResize={pane.setListWidth}
                  onReset={pane.resetListWidth}
                />
                <AgentEditor
                  doc={doc}
                  source={agent.source}
                  drafts={drafts}
                  onDrafts={applyEditorDrafts}
                  onSaveBlock={(id) => saveBlocks([id])}
                  onRevertBlock={revertBlock}
                  onSave={saveAll}
                  onDiscard={revertAll}
                  compact={compact}
                  onCompact={setCompact}
                  readonly={agent.source === 'bundled'}
                  onClose={() => setEditorOpen(false)}
                />
              </>
            )}
            {variant === 'drawer' && advisorOpen && (
              <div className="advisor-drawer" ref={drawerRef}>
                <AdvisorPanel findings={findings} agents={agents} models={models} aliases={aliases} channelRows={CHANNEL_TABLE} selectedAgent={agent.agentName} onSelectAgent={(n) => selectAgent(n, true)} onRemap={remapAlias} />
              </div>
            )}
          </div>
        )}
        {tab === 'sections' && (
          <ClipLibrary
            clips={clips}
            agents={agents}
            overrides={clipOverrides}
            onAdd={addClip}
            onRename={renameClip}
            onDelete={deleteClip}
            onOpenAgent={(name) => selectAgent(name, true)}
            focusName={focusClip}
            onFocusConsumed={() => setFocusClip(null)}
          />
        )}
        {tab === 'models' && (
          <ModelLinks
            models={models}
            aliases={aliases}
            agents={agents}
            onSetAvailable={toggleAvailable}
            onRemap={remapAliasAt}
            onDeleteAlias={deleteAlias}
            onDeleteModel={deleteModel}
            onAddAlias={addAlias}
            onAddModel={addModel}
            onOpenAgent={(name) => selectAgent(name, true)}
            onOpenPrompt={(modelName) => { setFocusModelName(modelName); setTab('prompts') }}
            focus={focusModelLink}
            onFocusConsumed={() => setFocusModelLink(null)}
          />
        )}
        {tab === 'prompts' && (
          <SystemPrompts
            models={models}
            aliases={aliases}
            onSaveSysPrompt={saveSysPrompt}
            onOpenRegistry={() => setTab('models')}
            focusModelName={focusModelName}
            onFocusConsumed={() => setFocusModelName(null)}
          />
        )}
        {tab === 'advisor' && (
          <div className="advisor-page">
            <AdvisorPanel findings={findings} agents={agents} models={models} aliases={aliases} channelRows={CHANNEL_TABLE} selectedAgent={agent.agentName} onSelectAgent={(n) => selectAgent(n, true)} onRemap={remapAlias} />
          </div>
        )}
      </main>
      <Inspector open={inspectorOpen} onToggle={() => setInspectorOpen((v) => !v)} files={files} lastWrites={lastWrites} log={log} />
      <VariantBar
        variant={variant}
        onVariant={setVariant}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        editorOpen={editorOpen}
        onToggleEditor={() => setEditorOpen((v) => !v)}
        showEditorToggle={tab === 'agents'}
      />
    </div>
  )
}
