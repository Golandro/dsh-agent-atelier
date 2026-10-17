/**
 * PROTOTYPE — 应用装配：全部状态在内存（刷新即重置），tab/变体同步进 URL（可分享）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { AgentDoc, FileWrite, PromptClip } from './types'
import { AGENTS, ALIASES, CLIPS, KNOWN_SKILLS, KNOWN_TOOLS, MODELS, WORKSPACES, CHANNEL_TABLE } from './fixtures'
import { composeDocument, inspectAll, remapImpact, resolveChain, saveWrites } from './model'
import { TopBar } from './components/TopBar'
import { Tabs } from './components/Tabs'
import { AgentList } from './components/AgentList'
import { AgentEditor } from './components/AgentEditor'
import { ClipLibrary } from './components/ClipLibrary'
import { SystemPrompts } from './components/SystemPrompts'
import { AdvisorPanel } from './components/AdvisorPanel'
import { Inspector } from './components/Inspector'
import type { InspectorFile, LogEntry } from './components/Inspector'
import { VariantBar } from './components/VariantBar'

export type Tab = 'agents' | 'sections' | 'prompts' | 'advisor'
export type AdvisorVariant = 'drawer' | 'tab'

const readUrl = () => {
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('tab')
  const advisor = q.get('advisor')
  return {
    tab: (['agents', 'sections', 'prompts', 'advisor'].includes(tab ?? '') ? tab : 'agents') as Tab,
    advisor: (advisor === 'tab' ? 'tab' : 'drawer') as AdvisorVariant,
  }
}

let seq = 1
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/* ── Agent List / Editor 分栏度量 ─────────────────────────────────
 * 左侧列表最小 20rem（≈320px）、默认 24rem（≈384px）；
 * 右侧编辑器最小 40rem（≈640px）；分隔条 0.375rem。
 * 两者放不下（< 60.375rem，约 966px）时编辑器改为浮层覆盖列表，
 * 不再压缩编辑区。阈值随根字号缩放。 */
const LIST_MIN_REM = 20
const LIST_DEFAULT_REM = 24
const EDITOR_MIN_REM = 40
const SPLITTER_REM = 0.375

/** 无已保存覆盖时的稳定空对象（避免 useMemo 每次失效）。 */
const EMPTY_BLOCK_OVERRIDES: Record<string, string> = {}

const rootFontSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

interface PaneMetrics {
  available: number
  minList: number
  minEditor: number
  splitter: number
  overlay: boolean
}

function readPaneMetrics(page: HTMLElement | null, drawer: HTMLElement | null, hasDrawer: boolean): PaneMetrics {
  const rem = rootFontSize()
  const pageWidth = page?.clientWidth ?? window.innerWidth
  const drawerWidth = hasDrawer && drawer ? drawer.offsetWidth : 0
  const available = Math.max(0, pageWidth - drawerWidth)
  const minList = LIST_MIN_REM * rem
  const minEditor = EDITOR_MIN_REM * rem
  const splitter = SPLITTER_REM * rem
  return { available, minList, minEditor, splitter, overlay: available < minList + minEditor + splitter }
}

export default function App() {
  const [initial] = useState(readUrl)
  const [tab, setTab] = useState<Tab>(initial.tab)
  const [variant, setVariant] = useState<AdvisorVariant>(initial.advisor)
  const [workspace, setWorkspace] = useState(WORKSPACES[0]!)

  const [agents, setAgents] = useState<AgentDoc[]>(AGENTS)
  const [clips, setClips] = useState<PromptClip[]>(CLIPS)
  const [models, setModels] = useState(MODELS)
  const [aliases, setAliases] = useState(ALIASES)

  const [selectedAgent, setSelectedAgent] = useState('code-reviewer')
  const pageRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<PaneMetrics>(() => readPaneMetrics(null, null, false))
  const [listWidth, setListWidth] = useState(() => LIST_DEFAULT_REM * rootFontSize())
  // 放得下（列表 20rem + 编辑器 40rem + 分隔条）默认并列；否则默认先看列表，
  // 选中 agent 时编辑器以浮层覆盖列表。
  const [editorOpen, setEditorOpen] = useState(() => {
    const rem = rootFontSize()
    return window.innerWidth >= (LIST_MIN_REM + EDITOR_MIN_REM + SPLITTER_REM) * rem
  })
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

  useEffect(() => {
    const q = new URLSearchParams()
    if (tab !== 'agents') q.set('tab', tab)
    if (variant !== 'drawer') q.set('advisor', variant)
    window.history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}`)
  }, [tab, variant])

  // 测量可用宽度（扣除顾问抽屉），驱动“并列 vs 浮层”和拖拽边界。
  useLayoutEffect(() => {
    if (tab !== 'agents') return
    const update = () =>
      setMetrics(readPaneMetrics(pageRef.current, drawerRef.current, variant === 'drawer' && advisorOpen))
    update()
    const ro = new ResizeObserver(update)
    if (pageRef.current) ro.observe(pageRef.current)
    if (drawerRef.current) ro.observe(drawerRef.current)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [tab, variant, advisorOpen])

  const maxListWidth = Math.max(metrics.minList, metrics.available - metrics.minEditor - metrics.splitter)
  const defaultListWidth = Math.min(
    maxListWidth,
    Math.max(metrics.minList, metrics.minList * (LIST_DEFAULT_REM / LIST_MIN_REM)),
  )

  // 视口/抽屉变化后把已保存的列表宽度夹回合法范围。
  useLayoutEffect(() => {
    if (metrics.overlay) return
    setListWidth((w) => Math.min(maxListWidth, Math.max(metrics.minList, w)))
  }, [metrics.overlay, metrics.minList, maxListWidth])

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
  const doc = useMemo(() => composeDocument(agent, clips, { compact, overrides: docOverrides }), [agent, clips, compact, docOverrides])
  const findings = useMemo(() => inspectAll(agents, models, aliases, KNOWN_TOOLS, KNOWN_SKILLS), [agents, models, aliases])
  const chain = useMemo(() => resolveChain(agent, aliases, models), [agent, aliases, models])

  /* ── Agents 页 ── */
  const selectAgent = (name: string, jumpTab = false) => {
    if (Object.keys(drafts).length > 0 && name !== selectedAgent) pushLog('切换 agent：未保存改动已丢弃')
    setSelectedAgent(name)
    setDrafts({})
    setEditorOpen(true)
    if (jumpTab) setTab('agents')
  }

  /** 列表/编辑器之间的拖拽分栏；坐标按父容器（.agents-page）视口换算。 */
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const pageEl = pageRef.current
    if (!pageEl || metrics.overlay) return
    const startRect = pageEl.getBoundingClientRect()
    const startX = e.clientX - startRect.left
    const startWidth = pageEl.querySelector<HTMLElement>('.agent-list')?.getBoundingClientRect().width ?? listWidth
    const onMove = (ev: PointerEvent) => {
      const rect = pageEl.getBoundingClientRect()
      const localX = ev.clientX - rect.left
      setListWidth(Math.min(maxListWidth, Math.max(metrics.minList, startWidth + localX - startX)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('is-resizing')
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  /** 写块草稿；文本回到已保存值时自动视为干净（不产生空保存）。 */
  const setBlockDraft = (blockId: string, text: string) => {
    const saved = doc.blocks.find((b) => b.id === blockId)?.text
    setDrafts((d) => {
      if (text === saved) {
        if (!(blockId in d)) return d
        const { [blockId]: _, ...rest } = d
        return rest
      }
      return { ...d, [blockId]: text }
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
      : { agentName: name, frontmatter: { description: '', modelOrder: ['dsh-default'] }, extra: {}, body: '（在此写 persona 正文；用 `$ 切片名` 行引用切片）', source: 'project-dsh', origin: 'user', path: `.dsh/agents/${name}/${name}.agent.md` }
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
    pushLog(`新建 ${clip.file}；在 agent 正文用 \`$ ${name}\` 行引用`)
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

  /* ── System Prompts ── */
  const registryWrite = (path: string, reason: string): FileWrite => ({ file: path, reason, lines: 1 })
  const toggleAvailable = (modelName: string) => {
    setModels((ms) => ms.map((m) => (m.modelName === modelName ? { ...m, available: !m.available } : m)))
    const m = models.find((x) => x.modelName === modelName)
    markWrites([registryWrite(m?.path ?? 'registry.yaml', `available → ${!m?.available}`)])
    pushLog(`${modelName} available → ${!m?.available}（解析时${m?.available ? '跳过回退' : '恢复命中'}；写回 registry.yaml）`)
  }
  const saveSysPrompt = (modelName: string, text: string) => {
    setModels((ms) => ms.map((m) => (m.modelName === modelName ? { ...m, sysPrompt: text } : m)))
    const m = models.find((x) => x.modelName === modelName)
    markWrites([registryWrite(m?.path ?? 'registry.yaml', `sysPrompt 写回 ${modelName}`)])
    pushLog(`保存 ${modelName} 的 sysPrompt（per-model 提示词，D6）`)
  }
  const remapAlias = (alias: string, target: string) => {
    const impact = remapImpact(alias, target, agents, models, aliases)
    setAliases((as) => as.map((a) => (a.alias === alias ? { ...a, targets: [target] } : a)))
    const al = aliases.find((a) => a.alias === alias)
    markWrites([registryWrite(al?.path ?? 'registry.yaml', `S5 重映射 ${alias}`)])
    pushLog(`S5：${alias} 注入名不变；命中 ${impact.before?.modelName ?? '（无）'} → ${target}；受影响 agent：${impact.affectedAgents.join('、') || '无'}`)
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
            className={`agents-page${variant === 'drawer' && advisorOpen ? ' with-drawer' : ''}${editorOpen ? '' : ' editor-closed'}${editorOpen && metrics.overlay ? ' editor-overlay' : ''}`}
            style={{ '--list-width': `${listWidth}px` } as CSSProperties}
          >
            <AgentList agents={agents} findings={findings} selected={agent.agentName} onSelect={selectAgent} />
            {editorOpen && (
              <>
                <div
                  className="pane-splitter"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`调整列表宽度（列表最小 ${LIST_MIN_REM}rem，编辑器最小 ${EDITOR_MIN_REM}rem）`}
                  aria-valuemin={Math.round(metrics.minList)}
                  aria-valuemax={Math.round(maxListWidth)}
                  aria-valuenow={Math.round(listWidth)}
                  tabIndex={0}
                  onPointerDown={startResize}
                  onDoubleClick={() => setListWidth(defaultListWidth)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') setListWidth((w) => Math.max(metrics.minList, w - 16))
                    if (e.key === 'ArrowRight') setListWidth((w) => Math.min(maxListWidth, w + 16))
                  }}
                />
                <AgentEditor
                  doc={doc}
                  drafts={drafts}
                  onDraft={setBlockDraft}
                  onSaveBlock={(id) => saveBlocks([id])}
                  onRevertBlock={revertBlock}
                  onSave={saveAll}
                  onDiscard={revertAll}
                  compact={compact}
                  onCompact={setCompact}
                  chain={chain}
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
        {tab === 'sections' && <ClipLibrary clips={clips} agents={agents} onAdd={addClip} onRename={renameClip} onDelete={deleteClip} />}
        {tab === 'prompts' && <SystemPrompts models={models} aliases={aliases} agents={agents} onToggleAvailable={toggleAvailable} onSaveSysPrompt={saveSysPrompt} onRemap={remapAlias} />}
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
      />
    </div>
  )
}
