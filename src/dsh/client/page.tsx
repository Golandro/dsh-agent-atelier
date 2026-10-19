/**
 * 智能体工作区（票 05；Q2 裁决：只做 agents 选项卡，无顶栏、无 sections/models）。
 *
 * 布局：usePaneLayout + PaneSplitter 双栏——
 *   左 = 懒加载 ListChunk.AgentListView（同样的 loading / 失败 / 重试处理）
 *   右 = 选中 agent 时的编辑器 chrome（名称 / 路径 / 来源标签 / 关闭 / 保存全部 /
 *        全部回退 / plan 预览 chips / 保存状态）+ EditorMount；未选中时占位提示。
 *   容器宽度放不下两侧最小宽度时（styles.css 的 `@container pane`）切单栏：
 *        列表隐藏、编辑器独占主视图；JS 不再参与该决策。
 *   头部 = 题头行（标题 + 工作空间占位）+ 页签行（智能体 / 操作历史 / 配置
 *        + 刷新目录）；三个视图都保持挂载（hidden 切换），选中 agent、草稿与
 *        滚动位置不丢。
 *
 * 数据流：页面持有本组件作用域内的一个 createHttpControlClient() 实例（由壳传入）；
 *   onSelect → compose(agentName) → ComposedAgentDocument；
 *   drafts 按 agent 分桶（Record<agentName, Record<blockId, string>>），草稿文本与
 *   块原文一致时清除（不打扰编辑器，仅记账）。
 *
 * 保存流程（票面验收：写操作必须经 /plan 预览 + /commit）：
 *   drafts → DocumentEdit[]（kind: 'setBlockText'）→ plan(agentName, edits)
 *   → 有 rejections：展示且不 commit；有 entries：chips 预览 → 「确认写入」
 *   → commit(edits) → WriteReport 进操作历史 → 成功后重新 compose 并清掉已提交块草稿。
 *   块级保存 / 回退走同一条管线（仅该块 edit / 仅清该块草稿）。
 * 刷新目录：client.invalidate() → 重新 snapshot + recompose（页面内独立实现，
 *   保留选中与草稿；AbortController 清理语义与壳一致）。
 */
import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { ControlClientError } from '../../control/client-errors.ts'
import { nsClass } from './class-names.ts'
import { loadListChunk } from './chunk-loader.ts'
import { ConfigPlaceholder } from './config-placeholder.tsx'
import { EditorMount } from './editor-mount.tsx'
import { AdvisorPanel } from './advisor.tsx'
import { OperationHistory } from './operation-history.tsx'
import { PanelHeader } from './panel-header.tsx'
import { PANE_CONTENT_MIN_REM, PANE_LIST_MIN_REM, PaneSplitter, usePaneLayout } from './pane.tsx'

import type { ControlClient, ComposedAgentDocument, ControlSnapshot, DocumentEdit, WritePlan, WriteReport } from '../../control/index.ts'
import type { AgentListViewProps } from './chunk-contracts.ts'
import type { PanelTab, ReloadState } from './panel-types.ts'
import type { CSSProperties, ReactNode } from 'react'

export interface AgentsWorkspaceProps {
  /** 页面持有的控制面客户端实例（快照取自壳；compose/plan/commit/invalidate 走这里）。 */
  readonly client: ControlClient
  /** 壳快照状态机就绪后的初始快照；刷新目录后会本地替换。 */
  readonly initialSnapshot: ControlSnapshot
}

type DocState = 'idle' | 'loading' | 'ready' | 'error'

type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'planning' }
  | { readonly status: 'planned'; readonly plan: WritePlan; readonly edits: readonly DocumentEdit[] }
  | { readonly status: 'committing'; readonly plan: WritePlan; readonly edits: readonly DocumentEdit[] }
  | { readonly status: 'failed'; readonly message: string }

const EMPTY_DRAFTS: Readonly<Record<string, string>> = Object.freeze({})

export function AgentsWorkspace(props: AgentsWorkspaceProps): ReactNode {
  const { client } = props
  const containerRef = useRef<HTMLDivElement | null>(null)

  /* ── 快照（壳的初始快照作种子；刷新目录后本地替换） ── */
  const [snapshot, setSnapshot] = useState(props.initialSnapshot)

  /* ── 选中与文档 ── */
  const [selected, setSelected] = useState<string | null>(null)
  const [doc, setDoc] = useState<ComposedAgentDocument | null>(null)
  const [docState, setDocState] = useState<DocState>('idle')
  const [docError, setDocError] = useState('')
  const [composeAttempt, setComposeAttempt] = useState(0)

  /* ── 草稿（按 agent 分桶）与保存流程 ── */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [reports, setReports] = useState<WriteReport[]>([])
  const [reload, setReload] = useState<ReloadState>({ status: 'idle' })
  const [advisorOpen, setAdvisorOpen] = useState(false)
  /* 面板页签：智能体（列表 + 编辑器）/ 操作历史 / 配置占位。三个视图都保持挂载。 */
  const [tab, setTab] = useState<PanelTab>('agents')

  // 写路径 / 刷新目录是事件驱动的异步操作：卸载时中止在途请求。
  const writeAbortRef = useRef<AbortController | null>(null)
  const reloadAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => {
    writeAbortRef.current?.abort()
    reloadAbortRef.current?.abort()
  }, [])

  // compose：随选中变化；重跑（换 agent / 重试 / 刷新后 recompose）即中止上一次。
  useEffect(() => {
    if (selected === null) {
      setDoc(null)
      setDocState('idle')
      return
    }
    const controller = new AbortController()
    setDocState('loading')
    client.compose(selected, { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return
        setDoc(next)
        setDocState('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setDocState('error')
        setDocError(errorMessage(error))
      })
    return () => controller.abort()
  }, [client, selected, composeAttempt])

  const pane = usePaneLayout(containerRef)

  const agent = selected !== null ? snapshot.agents.find((a) => a.agentName === selected) : undefined
  const draftsForAgent = selected !== null ? (drafts[selected] ?? EMPTY_DRAFTS) : EMPTY_DRAFTS
  const dirtyCount = Object.keys(draftsForAgent).length
  const saveBusy = save.status === 'planning' || save.status === 'committing'

  /* ── 选中 / 草稿 ── */

  const handleSelect = (name: string | null): void => {
    if (name === '' || name === selected) return
    // 换 agent：草稿按名分桶保留，未确认的 plan 作废。
    setSelected(name)
    setSave({ status: 'idle' })
  }

  const handleDraftText = (blockId: string, text: string): void => {
    if (selected === null) return
    setDrafts((prev) => {
      const agentDrafts = prev[selected] ?? {}
      const sourceBlock = doc?.blocks.find((block) => block.id === blockId)
      const next = { ...agentDrafts }
      // 与块原文一致即清草稿（不算未保存改动）。
      if (sourceBlock !== undefined && text === sourceBlock.text) delete next[blockId]
      else next[blockId] = text
      return { ...prev, [selected]: next }
    })
    // 草稿变化使未确认的 plan 失效（提交中的不折腾，成功路径会自行收尾）。
    setSave((prev) => (prev.status === 'planned' ? { status: 'idle' } : prev))
  }

  /* ── 保存流程：drafts → edits → /plan → 预览 → /commit ── */

  const runPlan = (edits: readonly DocumentEdit[]): void => {
    if (selected === null) return
    writeAbortRef.current?.abort()
    const controller = new AbortController()
    writeAbortRef.current = controller
    setSave({ status: 'planning' })
    client.plan(selected, edits, { signal: controller.signal })
      .then((plan) => {
        if (!controller.signal.aborted) setSave({ status: 'planned', plan, edits })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setSave({ status: 'failed', message: errorMessage(error) })
      })
  }

  const handleSaveAll = (): void => {
    if (selected === null || doc === null) return
    const agentDrafts = drafts[selected] ?? {}
    const edits: DocumentEdit[] = []
    for (const block of doc.blocks) {
      const text = agentDrafts[block.id]
      if (text !== undefined && text !== block.text) {
        edits.push({ kind: 'setBlockText', agentName: selected, blockId: block.id, text })
      }
    }
    if (edits.length > 0) runPlan(edits)
  }

  // 块级保存：同一条 plan/commit 管线，只提交该块。
  const handleSaveBlock = (blockId: string): void => {
    if (selected === null || doc === null) return
    const block = doc.blocks.find((b) => b.id === blockId)
    const text = drafts[selected]?.[blockId]
    if (block === undefined || text === undefined || text === block.text) return
    runPlan([{ kind: 'setBlockText', agentName: selected, blockId: block.id, text }])
  }

  // 块级回退：只清该块草稿，编辑器经 sync 对账回已保存文本。
  const handleRevertBlock = (blockId: string): void => {
    if (selected === null) return
    setDrafts((prev) => {
      const current = prev[selected]
      if (current === undefined || !(blockId in current)) return prev
      const next = { ...current }
      delete next[blockId]
      return { ...prev, [selected]: next }
    })
    setSave((prev) => (prev.status === 'planned' ? { status: 'idle' } : prev))
  }

  const handleRevertAll = (): void => {
    if (selected === null) return
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[selected]
      return next
    })
    setSave((prev) => (prev.status === 'planned' ? { status: 'idle' } : prev))
  }

  const confirmCommit = (): void => {
    if (save.status !== 'planned' || save.plan.rejections.length > 0) return
    const { plan, edits } = save
    writeAbortRef.current?.abort()
    const controller = new AbortController()
    writeAbortRef.current = controller
    setSave({ status: 'committing', plan, edits })
    client.commit(edits, { signal: controller.signal })
      .then((report) => {
        if (controller.signal.aborted) return
        recordReport(report)
        // 成功后重新 compose（编辑器对账到已保存文本）并只清已提交块的草稿。
        clearCommittedDrafts(edits)
        setSave({ status: 'idle' })
        setComposeAttempt((a) => a + 1)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        // 适配层把「任一文件失败」表达为携带 report 的 ControlClientError，照常入账。
        const report = error instanceof ControlClientError ? error.report : undefined
        if (report !== undefined) recordReport(report)
        setSave({ status: 'failed', message: errorMessage(error) })
      })
  }

  const recordReport = (report: WriteReport): void => {
    setReports((prev) => [report, ...prev])
  }

  const clearCommittedDrafts = (edits: readonly DocumentEdit[]): void => {
    setDrafts((prev) => {
      if (selected === null) return prev
      const current = prev[selected]
      if (current === undefined) return prev
      const next = { ...current }
      for (const edit of edits) {
        if (edit.kind === 'setBlockText') delete next[edit.blockId]
      }
      return { ...prev, [selected]: next }
    })
  }

  const handleCancelPlan = (): void => {
    setSave((prev) => (prev.status === 'planned' ? { status: 'idle' } : prev))
  }

  /* ── 刷新目录：invalidate → 重新 snapshot + recompose（保留选中与草稿） ── */

  const handleInvalidate = (): void => {
    reloadAbortRef.current?.abort()
    const controller = new AbortController()
    reloadAbortRef.current = controller
    setReload({ status: 'reloading' })
    const options = { signal: controller.signal }
    client.invalidate(options)
      .then(() => client.snapshot(options))
      .then((next) => {
        if (controller.signal.aborted) return
        setSnapshot(next)
        setReload({ status: 'idle' })
        setComposeAttempt((a) => a + 1)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setReload({ status: 'failed', message: errorMessage(error) })
      })
  }

  /* ── 渲染 ── */

  // 单栏/双栏由 styles.css 的 `@container pane` 决定；这里只标记「有没有打开编辑器」。
  const pageClass = `${nsClass('agents-page')}${selected !== null ? '' : ' editor-closed'}`

  return h(Fragment, null,
    h(PanelHeader, { tab, onTab: setTab, reload, onRefresh: handleInvalidate }),

    // 测量锚点放在始终可见的 wrapper：切到操作历史时 .agents-page 虽然 hidden，
    // 列表宽度仍按面板真实宽度夹取，切回来不会掉回最小值。
    h('div', { className: nsClass('panel-body'), ref: containerRef },
      h('div',
        {
          className: pageClass,
          hidden: tab !== 'agents',
          style: { '--list-width': `${Math.round(pane.listWidth)}px` } as CSSProperties,
        },
        h('div', { className: nsClass('agent-list') },
        h(LazyAgentListView, { snapshot, selected, onSelect: handleSelect })),

      selected !== null && h(PaneSplitter, {
        label: `调整列表宽度（列表最小 ${PANE_LIST_MIN_REM}rem，编辑器最小 ${PANE_CONTENT_MIN_REM}rem）`,
        value: pane.listWidth,
        min: pane.minList,
        max: pane.maxListWidth,
        onResize: pane.setListWidth,
        onReset: pane.resetListWidth,
      }),

      selected !== null && h('section', { className: nsClass('agent-editor') },
        h('div', { className: 'editor-head' },
          h('div', { className: 'editor-titlebar' },
            h('span', { className: 'editor-title' }, agent?.name ?? selected),
            doc !== null && h('span',
              { className: `tag ${doc.source === 'bundled' ? 'tag-bundled' : 'tag-user'}` },
              `${layerLabel(doc.source)}${doc.source === 'bundled' ? ' · 只读' : ''}`),
            h('span', { className: 'editor-path', title: doc?.path ?? '' },
              h('code', { className: 'editor-path-text' }, doc?.path ?? '')),
            h('span', { className: 'editor-spacer' }),
            h('div', { className: 'editor-utils' },
              h('button',
                { type: 'button', className: 'btn btn-sm', 'aria-pressed': advisorOpen, onClick: () => setAdvisorOpen(!advisorOpen) },
                '顾问'),
              h('button',
                {
                  type: 'button',
                  className: 'btn btn-sm btn-icon editor-close',
                  'aria-label': `关闭 ${selected} 的编辑器`,
                  title: '关闭编辑器（草稿按 agent 保留）',
                  onClick: () => handleSelect(null),
                },
                '×'))),

          h('div', { className: 'editor-toolbar' },
            h('span', { className: 'editor-status' },
              dirtyCount === 0
                ? h('span', { className: 'dim' }, '无未保存改动')
                : h('span', { className: 'editor-dirty-chip' },
                    h('span', { className: 'lbl-full' }, `${dirtyCount} 块未保存`),
                    h('span', { className: 'lbl-tiny' }, `${dirtyCount} 块`))),
            h('span', { className: 'editor-tool-sep', 'aria-hidden': true }, '·'),
            save.status === 'planning' && h('span', { className: 'dim' }, '正在计划写入…'),
            save.status === 'committing' && h('span', { className: 'dim' }, '正在写入…'),
            save.status === 'failed' && h('span', { className: 'save-failed', role: 'alert' }, `保存失败：${save.message}`),
            h('span', { className: 'editor-spacer' }),
            h('button',
              { type: 'button', className: 'btn btn-sm', disabled: dirtyCount === 0 || saveBusy, onClick: handleRevertAll },
              h('span', { className: 'lbl-full' }, '全部回退'),
              h('span', { className: 'lbl-compact' }, '回退')),
            h('button',
              { type: 'button', className: 'btn btn-sm btn-primary', disabled: dirtyCount === 0 || saveBusy, onClick: handleSaveAll },
              h('span', { className: 'lbl-full' }, '保存全部'),
              h('span', { className: 'lbl-compact' }, '保存')))),

        save.status === 'planned' && save.plan.rejections.length > 0 && h('div', { className: 'plan-rejects', role: 'alert' },
          h('div', { className: 'dim' }, '计划拒绝了以下编辑，未写入：'),
          save.plan.rejections.map((rejection, i) => h('div', { key: i, className: 'plan-reject-row' },
            h('span', { className: 'tag tag-err' }, rejection.code),
            h('span', { className: 'dim' }, `编辑 #${rejection.editIndex}`),
            h('span', null, rejection.message)))),

        save.status === 'planned' && save.plan.rejections.length === 0 && h('div', { className: 'plan-preview' },
          save.plan.entries.length > 0
            ? h(Fragment, null,
                h('div', { className: 'plan-chips' },
                  save.plan.entries.map((entry, i) => h('span', { key: i, className: 'plan-chip' },
                    h('code', null, entry.file), ` · ${entry.blockIds.join(' / ')}`))),
                h('span', { className: 'editor-spacer' }),
                h('button', { type: 'button', className: 'btn btn-sm', onClick: handleCancelPlan }, '取消'),
                h('button', { type: 'button', className: 'btn btn-sm btn-primary', onClick: confirmCommit },
                  `确认写入（${save.plan.entries.length} 文件）`))
            : h('span', { className: 'dim' }, '（无可写入内容）'),
          save.plan.entries.length === 0 && h('span', { className: 'editor-spacer' }),
          save.plan.entries.length === 0 && h('button', { type: 'button', className: 'btn btn-sm', onClick: handleCancelPlan }, '取消')),

        h('div', { className: 'editor-body' },
          docState === 'loading' && h('div', { className: 'doc-editor-status' }, '正在加载文档…'),
          docState === 'error' && h('div', { className: 'doc-editor-status doc-editor-status-error', role: 'alert' },
            h('p', null, `文档加载失败：${docError}`),
            h('button',
              { type: 'button', className: 'btn btn-sm', onClick: () => setComposeAttempt((a) => a + 1) },
              '重试')),
          docState === 'ready' && doc !== null && h(EditorMount, {
            agentName: doc.agentName,
            framing: doc.framing,
            blocks: doc.blocks,
            drafts: draftsForAgent,
            readonly: doc.source === 'bundled',
            onDraftText: handleDraftText,
            onSaveBlock: handleSaveBlock,
            onRevertBlock: handleRevertBlock,
          })),

        advisorOpen && h('div', { className: nsClass('advisor-panel') },
          h(AdvisorPanel, { snapshot, selectedAgent: selected, onSelectAgent: handleSelect }))),

      selected === null && h('div', { className: nsClass('pane-placeholder') },
        h('p', null, '从左侧选择一个智能体开始编辑。'),
        h('p', { className: 'dim' }, '草稿按 agent 保留；关闭编辑器不会丢弃未保存改动。'),
        h('button',
          { type: 'button', className: 'btn btn-sm', 'aria-pressed': advisorOpen, onClick: () => setAdvisorOpen(!advisorOpen) },
          advisorOpen ? '收起顾问面板' : '顾问面板'),
        advisorOpen && h('div', { className: nsClass('advisor-panel') },
          h(AdvisorPanel, { snapshot, selectedAgent: selected, onSelectAgent: handleSelect })))),

      h(OperationHistory, {
        plan: save.status === 'planned' || save.status === 'committing' ? save.plan : null,
        reports,
        hidden: tab !== 'history',
      }),

      h(ConfigPlaceholder, { hidden: tab !== 'config' }),
    ),
  )
}

/* ── 懒加载列表（与编辑器同样的 loading / 失败 / 重试处理） ───────────── */

type ListChunkState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly AgentListView: (props: AgentListViewProps) => ReactNode }
  | { readonly status: 'error'; readonly message: string }

function LazyAgentListView(props: AgentListViewProps): ReactNode {
  const [state, setState] = useState<ListChunkState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    Promise.resolve()
      .then(loadListChunk)
      .then((chunk) => {
        if (!cancelled) setState({ status: 'ready', AgentListView: chunk.AgentListView as (p: AgentListViewProps) => ReactNode })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  if (state.status === 'loading') {
    return h('div', { className: 'list-chunk-status' }, '列表加载中…')
  }
  if (state.status === 'error') {
    return h('div', { className: 'list-chunk-status list-chunk-status-error', role: 'alert' },
      h('p', null, `列表加载失败：${state.message}`),
      h('button', { type: 'button', className: 'btn btn-sm', onClick: () => setAttempt(attempt + 1) }, '重试'))
  }
  const ListView = state.AgentListView
  return h(ListView, props)
}

/* ── 小工具 ─────────────────────────────────────────────────────────── */

/** 来源层标签（视图文案，照搬原型 model.ts 的 layerLabel）。 */
function layerLabel(source: ComposedAgentDocument['source']): string {
  switch (source) {
    case 'project-dsh': return 'workspace · .dsh'
    case 'project-agents': return 'workspace · .agents'
    case 'user-dsh': return 'user · ~/.dsh'
    case 'user-agents': return 'user · ~/.agents'
    case 'bundled': return 'bundled'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
