/**
 * 系统提示词预览面板（票 85）：7 条来源分组可折叠、段内块可展开、改写 / 遮蔽 /
 * 降级标注、顶部新鲜度条与副作用提示。
 *
 * 位置：嵌在「系统提示词」页顶部（页签数不变——`panel-types.ts` 是 4 值封闭联合，
 * 新增第五个页签要同时改 4 处硬编码）。样式仍挂在 `.agent-atelier-page` 下。
 *
 * 数据纪律（规格 #82 §4、brief §1.7 / §8）：
 * - 只渲染宿主读面已经投影好的 `PromptSegmentsView`（经 `onPreviewRequest` 拿），
 *   本组件不重跑装配、不重跑层合并、不自己投影——chunk 也根本读不到 `src/assembly/`。
 * - 预览**不自动重载**：没有轮询、没有 `useEffect` 监听快照；只有用户点「读取预览 /
 *   重新读取」才发一次请求。新鲜度条如实写「文件 mtime 不可用」。
 * - `scanId` 是**每请求自增的序号**，不是数据代次：文案里不出现「数据代次」「加载代次」。
 * - 副作用先声明后执行：面板常驻「预览会真实执行装配链」，回答里的 `sideEffects`
 *   原样逐条展示（读面自己声明的说法，UI 不改写）。
 *
 * 四档降级（规格 §5）各有可见态：① 完整 / ② 链耗尽（附候选与未命中原因）/
 * ③ 静态回退（标「非宿主装配结果」并逐项列 missing）/ ④ 空态错误。
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import {
  PREVIEW_MTIME_NOTE,
  PREVIEW_NO_AUTORELOAD_NOTE,
  PREVIEW_SIDE_EFFECT_HEADLINE,
  PREVIEW_STATIC_NOTICE,
  PREVIEW_TIER_LABEL,
  buildPreviewSourceRows,
  buildUnattributedRows,
  isPreviewCollapsed,
  previewChainSkipLines,
  previewDiagnosticLines,
  previewFreshnessLines,
  previewMissingLines,
  previewPartCount,
  previewSegmentCount,
  previewTierBanner,
  previewTierOf,
} from './prompt-preview-model.ts'

import type {
  PromptPreviewView,
  PromptSegmentsView,
  PromptSourceId,
} from '../../../dsh/client/chunk-contracts.ts'
import type { PromptPreviewPanelState, PreviewSourceRow, PreviewTag } from './prompt-preview-model.ts'

/* ── 受控视图 ─────────────────────────────────────────────────────── */

export interface PromptPreviewPanelProps {
  readonly state: PromptPreviewPanelState
  /** 可预览的 agent 名（来自快照，页面已按名字排序）。 */
  readonly agents: readonly string[]
  /** 没有 `onPreviewRequest` 时面板只读：按钮禁用并说明没接读面。 */
  readonly wired: boolean
  readonly onAgent?: ((agentName: string) => void) | undefined
  readonly onRequest?: (() => void) | undefined
  readonly onToggleGroup?: ((source: PromptSourceId) => void) | undefined
}

/** 受控视图：SSR / 组件测试按状态直接渲染，不跑 effect、不发请求。 */
export function PromptPreviewPanel(props: PromptPreviewPanelProps): ReactNode {
  const request = props.state.request
  const view = request.status === 'ready' ? request.view : undefined
  return h(
    'section',
    {
      className: 'prompt-preview',
      'data-preview-panel': '1',
      'data-preview-tier': view === undefined ? 'none' : previewTierOf(view.degraded),
      'aria-label': '系统提示词预览',
    },
    previewHead(props),
    freshnessBar(view),
    sideEffectBlock(view),
    previewBody(props, view),
  )
}

function previewHead(props: PromptPreviewPanelProps): ReactNode {
  const busy = props.state.request.status === 'loading'
  const agent = props.state.agent
  const view = props.state.request.status === 'ready' ? props.state.request.view : undefined
  return h(
    'div',
    { className: 'preview-head' },
    h('h3', { className: 'preview-title' }, '系统提示词预览'),
    view === undefined
      ? null
      : h('span', { className: 'tag tag-dim', 'data-preview-count': '1' },
          String(previewSegmentCount(view.segments)) + ' 段 / 7 来源'),
    h('span', { className: 'dim preview-note' }, '按来源分段：谁注册的、来自哪个文件、有没有被改写或遮蔽。'),
    h('span', { className: 'preview-head-fill' }),
    props.agents.length === 0
      ? h('span', { className: 'dim preview-note' }, '快照里没有 agent，没有可预览的对象。')
      : h(
          'select',
          {
            className: 'select preview-agent',
            value: agent ?? '',
            'aria-label': '选择要预览的 agent',
            onChange: (event: { target: { value: string } }) => props.onAgent?.(event.target.value),
          },
          agent === null ? h('option', { value: '' }, '（选择 agent）') : null,
          props.agents.map((name) => h('option', { key: name, value: name }, name)),
        ),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm btn-primary',
        'data-preview-request': '1',
        disabled: !props.wired || busy || agent === null,
        onClick: () => props.onRequest?.(),
      },
      busy ? '读取中…' : view === undefined ? '读取预览' : '重新读取',
    ),
  )
}

/** 顶部数据新鲜度条（Captain 裁决：没有 mtime 数据源，如实说不可用）。 */
function freshnessBar(view: PromptPreviewView | undefined): ReactNode {
  const lines = view === undefined
    ? [
        { label: '装配时刻', value: '尚未读取', note: undefined },
        { label: '本次请求序号', value: '尚未读取', note: '读面每请求自增的序号，不是数据代次。' },
        { label: '装配所用 agent', value: '尚未读取', note: undefined },
        { label: '扫描起点', value: '尚未读取', note: undefined },
        { label: '文件 mtime', value: '不可用', note: PREVIEW_MTIME_NOTE },
      ]
    : previewFreshnessLines(view)
  return h(
    'div',
    { className: 'preview-freshness', 'data-preview-freshness': '1' },
    lines.map((line) => h(
      'div',
      { key: line.label, className: 'preview-freshness-row' },
      h('span', { className: 'dim preview-freshness-label' }, line.label),
      h('span', { className: 'preview-freshness-value' }, line.value),
      line.note === undefined ? null : h('span', { className: 'dim preview-freshness-note' }, line.note),
    )),
    h('div', { className: 'preview-freshness-row' },
      h('span', { className: 'dim preview-freshness-label' }, '自动重载'),
      h('span', { className: 'preview-freshness-value' }, '不做'),
      h('span', { className: 'dim preview-freshness-note' }, PREVIEW_NO_AUTORELOAD_NOTE)),
  )
}

/** 副作用：面板常驻一句 + 读面声明逐条（每次回答都带）。 */
function sideEffectBlock(view: PromptPreviewView | undefined): ReactNode {
  const declared = view === undefined ? [] : view.sideEffects
  return h(
    'div',
    { className: 'preview-side-effect', role: 'note', 'data-preview-side-effect': '1' },
    h('strong', null, PREVIEW_SIDE_EFFECT_HEADLINE),
    h('span', { className: 'dim' }, '：这条路由会真的跑一次宿主装配，不是静态推断。'),
    declared.length === 0
      ? null
      : h('ul', { className: 'preview-side-effect-list' },
          declared.map((line, index) => h('li', { key: index }, line))),
  )
}

function previewBody(props: PromptPreviewPanelProps, view: PromptPreviewView | undefined): ReactNode {
  const request = props.state.request
  if (!props.wired) {
    return h('p', { className: 'dim preview-empty' }, '没有接入预览读面（`onPreviewRequest` 缺席）：预览只读，不在这里重跑装配。')
  }
  if (request.status === 'idle') {
    return h('p', { className: 'dim preview-empty' }, '还没读取预览。选一个 agent 后点「读取预览」——注意这会真的执行一次装配链。')
  }
  if (request.status === 'loading') {
    return h('p', { className: 'preview-status', role: 'status' }, '正在装配 ' + request.agent + ' 的系统提示词…')
  }
  if (request.status === 'error') {
    return h(
      'div',
      { className: 'preview-error', role: 'alert' },
      h('p', null, '预览读取失败：' + request.message),
      h('button', { type: 'button', className: 'btn btn-sm', onClick: () => props.onRequest?.() }, '重试'),
    )
  }
  if (view === undefined) return null
  const tier = previewTierOf(view.degraded)
  // 段组只在「这次真的装配了」或「真有段」时出现：②③④ 档装配没发生，摆 7 个空组
  // 会让人以为「宿主装配了但什么都没产出」——那是另一种事实。① 档即使 0 段也摆，
  // 因为那时「7 条来源本次都没贡献」正是要看的结论（规格 §9 第 1 条）。
  const showGroups = tier === 'full' || previewSegmentCount(view.segments) > 0
  return h(
    'div',
    { className: 'preview-body' },
    tierBanner(tier, view),
    showGroups ? sourceGroups(props, view.segments) : null,
    unattributedBlock(view),
    diagnosticsBlock(view),
    notesBlock(view),
  )
}

function tierBanner(tier: ReturnType<typeof previewTierOf>, view: PromptPreviewView): ReactNode {
  const tone = tier === 'full' ? 'tag-ok' : tier === 'static' ? 'tag-warn' : 'tag-err'
  return h(
    'div',
    { className: 'preview-tier', 'data-preview-tier': tier },
    h('span', { className: 'tag ' + tone }, PREVIEW_TIER_LABEL[tier]),
    h('span', { className: 'preview-tier-text' }, previewTierBanner(tier)),
    view.degraded === undefined
      ? null
      : h('span', { className: 'dim preview-tier-reason' }, '原因：' + view.degraded.reason),
    tier === 'static' ? h('span', { className: 'tag tag-warn' }, PREVIEW_STATIC_NOTICE) : null,
    missingBlock(view),
    chainBlock(view),
  )
}

function missingBlock(view: PromptPreviewView): ReactNode {
  const lines = previewMissingLines(view.degraded)
  if (lines.length === 0) return null
  return h(
    'div',
    { className: 'preview-missing', 'data-preview-missing': '1' },
    h('div', { className: 'preview-sub-title' }, '缺什么（逐项）'),
    h('ul', { className: 'preview-missing-list' }, lines.map((line, index) => h('li', { key: index }, line))),
  )
}

function chainBlock(view: PromptPreviewView): ReactNode {
  const lines = previewChainSkipLines(view.degraded)
  if (lines.length === 0) return null
  return h(
    'div',
    { className: 'preview-chain', 'data-preview-chain': '1' },
    h('div', { className: 'preview-sub-title' }, '链解析报告（引擎原样，未改写）'),
    h('ul', { className: 'preview-chain-list' }, lines.map((line, index) => h('li', { key: index }, line))),
  )
}

function sourceGroups(props: PromptPreviewPanelProps, view: PromptSegmentsView): ReactNode {
  const rows = buildPreviewSourceRows(view)
  return h(
    'div',
    { className: 'preview-groups' },
    rows.map((row) => groupBlock(row, props)),
  )
}

function groupBlock(row: PreviewSourceRow, props: PromptPreviewPanelProps): ReactNode {
  const collapsed = isPreviewCollapsed(props.state.collapsed, row.source)
  return h(
    'section',
    {
      key: row.source,
      className: 'preview-group' + (row.empty ? ' empty' : ''),
      'data-preview-source': row.source,
      'data-preview-collapsed': collapsed ? '1' : '0',
    },
    h(
      'button',
      {
        type: 'button',
        className: 'preview-group-head',
        'aria-expanded': !collapsed,
        'data-preview-toggle': row.source,
        onClick: () => props.onToggleGroup?.(row.source),
      },
      h('span', { className: 'preview-group-caret' }, collapsed ? '▸' : '▾'),
      h('span', { className: 'preview-group-heading' }, row.heading),
      h('span', { className: 'tag tag-dim' }, String(row.segments.length) + ' 段'),
      h('span', { className: 'dim preview-group-registrant' }, row.registrant),
    ),
    collapsed
      ? null
      : row.empty
        ? h('p', { className: 'dim preview-group-empty' }, '这一来源本次没有贡献任何段（组保留，不隐藏）。')
        : h('div', { className: 'preview-group-body' }, row.segments.map((segment) => segmentBlock(segment))),
  )
}

function segmentBlock(segment: ReturnType<typeof buildPreviewSourceRows>[number]['segments'][number]): ReactNode {
  return h(
    'article',
    { key: segment.key, className: 'preview-segment', 'data-preview-segment': segment.name },
    h(
      'div',
      { className: 'preview-segment-head' },
      h('code', { className: 'preview-segment-name' }, segment.name),
      segment.tags.map((tag: PreviewTag, index: number) => h('span', { key: index, className: 'tag tag-' + tag.tone }, tag.text)),
    ),
    segment.parts.expandable
      ? h(
          'details',
          { className: 'preview-parts', 'data-preview-parts': String(previewPartCount(segment.parts.parts)) },
          h('summary', null, '段内块 ' + String(previewPartCount(segment.parts.parts)) + ' 个（展开查看）'),
          h(
            'div',
            { className: 'preview-parts-body' },
            segment.parts.parts.map((part, index) => h(
              'div',
              { key: index, className: 'preview-part' },
              h('div', { className: 'dim preview-part-name' }, part.name),
              h('pre', { className: 'preview-text' }, part.text),
            )),
          ),
        )
      : h('pre', { className: 'preview-text' }, segment.parts.parts[0]?.text ?? segment.text),
  )
}

function unattributedBlock(view: PromptPreviewView): ReactNode {
  const rows = buildUnattributedRows(view.segments)
  if (rows.length === 0) return null
  return h(
    'section',
    { className: 'preview-group preview-unattributed', 'data-preview-source': 'unattributed' },
    h(
      'div',
      { className: 'preview-group-head' },
      h('span', { className: 'preview-group-heading' }, '未归因段'),
      h('span', { className: 'tag tag-warn' }, String(rows.length) + ' 段'),
      h('span', { className: 'dim preview-group-registrant' }, '账本没记、产物也认不出一级来源：如实列出，不猜。'),
    ),
    h('div', { className: 'preview-group-body' }, rows.map((segment) => segmentBlock(segment))),
  )
}

function diagnosticsBlock(view: PromptPreviewView): ReactNode {
  const lines = previewDiagnosticLines(view.segments.diagnostics)
  if (lines.length === 0) return null
  return h(
    'div',
    { className: 'preview-diagnostics', 'data-preview-diagnostics': '1' },
    h('div', { className: 'preview-sub-title' }, '诊断信号（不是错误）'),
    h('ul', { className: 'preview-diagnostics-list' }, lines.map((line, index) => h('li', { key: index }, line))),
  )
}

function notesBlock(view: PromptPreviewView): ReactNode {
  if (view.notes.length === 0) return null
  return h(
    'ul',
    { className: 'preview-notes' },
    view.notes.map((note, index) => h('li', { key: index, className: 'dim' }, note)),
  )
}