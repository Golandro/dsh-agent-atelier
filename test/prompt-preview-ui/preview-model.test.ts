/**
 * 预览纯投影的行为锚点（票 85）：来源分组、段内展开、标注、四档降级、新鲜度条。
 *
 * 只断言**可见行为**与纯函数的返回值，不碰 DOM（本仓没有 DOM 环境）。
 */
import { describe, expect, it } from 'vitest'

import {
  PREVIEW_MTIME_NOTE,
  PREVIEW_NO_AUTORELOAD_NOTE,
  PREVIEW_SIDE_EFFECT_HEADLINE,
  PREVIEW_SOURCE_LABELS,
  PREVIEW_STATIC_NOTICE,
  PREVIEW_TIER_LABEL,
  buildPreviewSourceRows,
  buildUnattributedRows,
  isPreviewCollapsed,
  previewAgentNames,
  previewChainSkipLines,
  previewDiagnosticLines,
  previewFreshnessLines,
  previewMissingLines,
  previewPartsOf,
  previewSegmentCount,
  previewSegmentTags,
  previewShadowText,
  previewStateLoading,
  previewStateSettled,
  previewStateWithAgent,
  previewTierBanner,
  previewTierOf,
  toggledPreviewGroup,
} from '../../src/client/chunks/registry/prompt-preview-model.ts'
import { INITIAL_PREVIEW_PANEL_STATE } from '../../src/client/chunks/registry/prompt-preview-model.ts'
import {
  SOURCE_ORDER,
  chainExhaustedView,
  emptyStateView,
  emptyView,
  fullView,
  sevenSourceView,
  shadowedView,
  staticView,
} from './fixtures.ts'

describe('7 条来源的分组', () => {
  it('7 条来源各有词表，顺序与契约一致，空组保留', () => {
    expect(Object.keys(PREVIEW_SOURCE_LABELS)).toEqual([...SOURCE_ORDER])
    const rows = buildPreviewSourceRows(emptyView())
    expect(rows).toHaveLength(7)
    expect(rows.map((row) => row.source)).toEqual([...SOURCE_ORDER])
    // 空组不隐藏：段数为 0，仍带标题与注册者说明。
    for (const row of rows) {
      expect(row.empty).toBe(true)
      expect(row.segments).toHaveLength(0)
      expect(row.heading).not.toBe('')
      expect(row.registrant).not.toBe('')
    }
  })

  it('组标题带规格里的圈号，注册者一句话可读', () => {
    const rows = buildPreviewSourceRows(sevenSourceView())
    const bySource = new Map(rows.map((row) => [row.source, row]))
    expect(bySource.get('harness-identity')?.heading).toBe('① harness identity')
    expect(bySource.get('tool-guidance')?.heading).toBe('⑤ 工具说明节')
    expect(bySource.get('tool-declaration')?.heading).toBe('⑦ 工具声明')
    expect(bySource.get('atelier-section')?.registrant).toContain('本仓 sink')
  })

  it('组内段按宿主装配名呈现，行 key 不撞（同名的 context 与 section 各占一行）', () => {
    const rows = buildPreviewSourceRows(sevenSourceView())
    const allKeys = rows.flatMap((row) => row.segments.map((segment) => segment.key))
    expect(new Set(allKeys).size).toBe(allKeys.length)
    const tool = rows.find((row) => row.source === 'tool-guidance')
    expect(tool?.segments.map((segment) => segment.name)).toEqual(['tools:sdk'])
  })

  it('不可归因的段单独成组，且不借用任何一级来源的标题', () => {
    const rows = buildUnattributedRows(shadowedView())
    expect(rows.map((row) => row.name)).toEqual(['unknown:section'])
    expect(rows[0]?.key.startsWith('unattributed')).toBe(true)
    // 7 组里没有这一段（不猜来源）。
    const grouped = buildPreviewSourceRows(shadowedView()).flatMap((row) => row.segments.map((s) => s.name))
    expect(grouped).not.toContain('unknown:section')
  })

  it('段总数 = 各组之和 + 不可归因', () => {
    expect(previewSegmentCount(emptyView())).toBe(0)
    // 7 组里有 6 组各一段（preset-persona 是空组，如实保留）。
    expect(previewSegmentCount(sevenSourceView())).toBe(6)
    // 遮蔽视图：2 段 + 1 条不可归因。
    expect(previewSegmentCount(shadowedView())).toBe(3)
  })
})

describe('折叠（每组可折叠，缺省展开）', () => {
  it('缺省展开；切换一次折叠，再切换回来展开（展开即删键，不攒 false）', () => {
    const initial = {}
    expect(isPreviewCollapsed(initial, 'atelier-section')).toBe(false)
    const collapsed = toggledPreviewGroup(initial, 'atelier-section')
    expect(isPreviewCollapsed(collapsed, 'atelier-section')).toBe(true)
    const reopened = toggledPreviewGroup(collapsed, 'atelier-section')
    expect(isPreviewCollapsed(reopened, 'atelier-section')).toBe(false)
    expect(Object.keys(reopened)).toEqual([])
  })

  it('折叠是逐组的：折一组不影响别组', () => {
    const collapsed = toggledPreviewGroup({}, 'tool-guidance')
    expect(isPreviewCollapsed(collapsed, 'tool-guidance')).toBe(true)
    expect(isPreviewCollapsed(collapsed, 'harness-identity')).toBe(false)
  })
})

describe('段内块（多块才展开，内容不丢）', () => {
  it('多块可展开，块数与内容原样', () => {
    const segment = sevenSourceView().sources.find((g) => g.source === 'tool-guidance')?.segments[0]
    expect(segment).toBeDefined()
    const parts = previewPartsOf(segment!)
    expect(parts.expandable).toBe(true)
    expect(parts.parts.map((part) => part.name)).toEqual(['bash', 'read'])
  })

  it('单块整段渲染（不展开），块文本就是段文本', () => {
    const parts = previewPartsOf({ name: 'atelier:model-sys', surface: 'section', text: 'whole text' })
    expect(parts.expandable).toBe(false)
    expect(parts.parts).toHaveLength(1)
    expect(parts.parts[0]?.text).toBe('whole text')
  })

  it('空 parts 表也整段渲染：内容不丢', () => {
    const parts = previewPartsOf({ name: 'x', surface: 'section', text: 'still here', parts: [] })
    expect(parts.expandable).toBe(false)
    expect(parts.parts[0]?.text).toBe('still here')
  })
})

describe('标注：改写 / 遮蔽 / 层 / 别名', () => {
  it('waterfall 改写只在 true 时标注（缺席不等于「没改写」）', () => {
    const rewritten = previewSegmentTags({ name: 'a', surface: 'section', text: '', rewrittenByWaterfall: true })
    expect(rewritten.map((tag) => tag.text)).toContain('已被 waterfall 改写')
    const unknown = previewSegmentTags({ name: 'a', surface: 'section', text: '' })
    expect(unknown.map((tag) => tag.text)).not.toContain('已被 waterfall 改写')
  })

  it('遮蔽：visible 给出被遮蔽者，opaque 只说「遮蔽关系不可见」', () => {
    expect(previewShadowText({ visibility: 'opaque' })).toBe('遮蔽关系不可见')
    expect(previewShadowText({ visibility: 'visible', displaced: 'preset scope' })).toContain('preset scope')
    const opaque = previewSegmentTags({ name: 'a', surface: 'section', text: '', shadowedBy: { visibility: 'opaque' } })
    expect(opaque.map((tag) => tag.text)).toContain('遮蔽关系不可见')
    // opaque 不得编出遮蔽者：文案里没有任何「遮蔽了同名注册」。
    expect(opaque.map((tag) => tag.text).join(' ')).not.toContain('遮蔽了同名注册')
  })

  it('层与别名只在账本记了时出现，别名只在与宿主名不同时标注', () => {
    const tags = previewSegmentTags({
      name: 'atelier:model-sys',
      surface: 'section',
      text: '',
      planName: 'model-system',
      layer: '.dsh/agents/assembly.yml',
    })
    expect(tags.map((tag) => tag.text)).toContain('来自 .dsh/agents/assembly.yml')
    expect(tags.map((tag) => tag.text)).toContain('规划名 model-system')
    const sameName = previewSegmentTags({ name: 'x', surface: 'section', text: '', planName: 'x' })
    expect(sameName.map((tag) => tag.text)).not.toContain('规划名 x')
  })

  it('context / tool 通道各自标注，section 不标注', () => {
    const context = previewSegmentTags({ name: 'c', surface: 'context', text: '' })
    expect(context.map((tag) => tag.text)).toContain('运行时 context')
    const tool = previewSegmentTags({ name: 't', surface: 'tool', text: '' })
    expect(tool.map((tag) => tag.text)).toContain('工具声明')
    const section = previewSegmentTags({ name: 's', surface: 'section', text: '' })
    expect(section).toEqual([])
  })
})

describe('四档降级各有可见态', () => {
  it('档位判定：没有 degraded 就是完整装配（① 不是第四个字符串）', () => {
    expect(previewTierOf(undefined)).toBe('full')
    expect(previewTierOf(chainExhaustedView().degraded)).toBe('chain-exhausted')
    expect(previewTierOf(staticView().degraded)).toBe('static')
    expect(previewTierOf(emptyStateView().degraded)).toBe('empty')
  })

  it('四档各有横幅文案；③ 必须一眼看出「非宿主装配结果」', () => {
    for (const tier of ['full', 'chain-exhausted', 'static', 'empty'] as const) {
      expect(PREVIEW_TIER_LABEL[tier]).not.toBe('')
      expect(previewTierBanner(tier)).not.toBe('')
    }
    expect(PREVIEW_STATIC_NOTICE).toBe('非宿主装配结果')
    expect(previewTierBanner('static')).toContain(PREVIEW_STATIC_NOTICE)
    expect(previewTierBanner('static')).toContain('没有跑 assemble()')
  })

  it('② 附链解析报告：候选路线 + 未命中原因，不重算引擎', () => {
    const lines = previewChainSkipLines(chainExhaustedView().degraded)
    expect(lines[0]).toContain('候选 2 个')
    expect(lines[0]).toContain('无（链耗尽）')
    // 第一条候选没有 route（目标缺失），如实写「目标模型条目缺失」。
    expect(lines[1]).toContain('目标模型条目缺失')
    expect(lines[1]).toContain('available:false，解析时跳过')
    expect(lines[2]).toContain('前序目标已命中，未到达')
    // 完整装配没有链报告（没有 degraded）。
    expect(previewChainSkipLines(undefined)).toEqual([])
  })

  it('③ 逐项列 missing（缺什么、为什么）', () => {
    const lines = previewMissingLines(staticView().degraded)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('live-agent')
    expect(lines[0]).toContain('没有活跃会话')
    expect(lines[1]).toContain('host-config')
    expect(previewMissingLines(undefined)).toEqual([])
  })

  it('④ 空态：原因原样带出，不出现段组', () => {
    const view = emptyStateView()
    expect(view.degraded?.reason).toContain('ENOENT')
    expect(previewTierOf(view.degraded)).toBe('empty')
    expect(previewSegmentCount(view.segments)).toBe(0)
  })

  it('诊断信号逐条列出（不是错误）', () => {
    const lines = previewDiagnosticLines(shadowedView().diagnostics)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('alias-mismatch')
    expect(lines[1]).toContain('missing-from-assembly')
  })
})

describe('顶部新鲜度条（Captain 裁决口径）', () => {
  it('只给装配时刻 / 本次请求序号 / agent / 扫描起点 / mtime 不可用', () => {
    const lines = previewFreshnessLines({
      agentName: 'fast-agent',
      cwd: '/work',
      assembledAt: '2026-11-26T05:00:00.000Z',
      scanId: 42,
    })
    expect(lines.map((line) => line.label)).toEqual(['装配时刻', '本次请求序号', '装配所用 agent', '扫描起点', '文件 mtime'])
    expect(lines[1]?.value).toBe('42')
    expect(lines[1]?.note).toContain('不是数据代次')
    expect(lines[4]?.value).toBe('不可用')
    expect(lines[4]?.note).toBe(PREVIEW_MTIME_NOTE)
  })

  it('用户全局时扫描起点写「用户全局」，不编路径', () => {
    const lines = previewFreshnessLines({ agentName: 'a', cwd: null, assembledAt: 'now', scanId: 1 })
    expect(lines[3]?.value).toContain('用户全局')
  })

  it('scanId 的标签与值都不叫「代次」；不自动重载是明写的', () => {
    const lines = previewFreshnessLines({ agentName: 'a', cwd: '/w', assembledAt: 'now', scanId: 1 })
    // 标签与值里绝不出现「数据代次」「加载代次」——那是错误口径。
    for (const line of lines) {
      expect(line.label).not.toContain('代次')
      expect(line.value).not.toContain('代次')
    }
    // scanId 那一行只允许**否定式**提到代次（「不是数据代次」），说明它是什么、不是什么。
    const scan = lines[1]
    expect(scan?.label).toBe('本次请求序号')
    expect(scan?.note).toContain('不是数据代次')
    expect(scan?.note).not.toContain('加载代次')
    expect(PREVIEW_NO_AUTORELOAD_NOTE).toContain('不会自动重载')
    expect(PREVIEW_MTIME_NOTE).toContain('不判断「文件是否已改」')
  })

  it('副作用标题是「预览会真实执行装配链」', () => {
    expect(PREVIEW_SIDE_EFFECT_HEADLINE).toBe('预览会真实执行装配链')
  })
})

describe('请求状态机', () => {
  const base = { ...INITIAL_PREVIEW_PANEL_STATE, agent: 'fast-agent' }

  it('换 agent 把请求状态退回 idle（旧回答不属于新 agent）', () => {
    const ready = previewStateSettled(base, 'fast-agent', { ok: true, view: fullView() })
    expect(ready.request.status).toBe('ready')
    const switched = previewStateWithAgent(ready, 'slow-agent')
    expect(switched.agent).toBe('slow-agent')
    expect(switched.request.status).toBe('idle')
  })

  it('没有读面或没选 agent 时不发请求', () => {
    expect(previewStateLoading(base, false)).toBe(base)
    const noAgent = { ...INITIAL_PREVIEW_PANEL_STATE }
    expect(previewStateLoading(noAgent, true)).toBe(noAgent)
    expect(previewStateLoading(base, true).request).toEqual({ status: 'loading', agent: 'fast-agent' })
  })

  it('成功进 ready；abort 退回 idle；失败进 error', () => {
    const view = fullView()
    expect(previewStateSettled(base, 'fast-agent', { ok: true, view }).request).toEqual({ status: 'ready', agent: 'fast-agent', view })
    const aborted = previewStateSettled(base, 'fast-agent', { ok: false, error: new DOMException('aborted', 'AbortError') })
    expect(aborted.request.status).toBe('idle')
    const failed = previewStateSettled(base, 'fast-agent', { ok: false, error: new Error('boom') })
    expect(failed.request.status).toBe('error')
    expect(failed.request.status === 'error' ? failed.request.message : '').toContain('boom')
  })

  it('陈旧的回答被丢弃：agent 换了就不覆盖新面板', () => {
    const switched = previewStateWithAgent(base, 'slow-agent')
    const stale = previewStateSettled(switched, 'fast-agent', { ok: true, view: fullView() })
    expect(stale).toBe(switched)
  })

  it('agent 名排序稳定（按名字，不随发现顺序漂）', () => {
    expect(previewAgentNames([{ agentName: 'b' }, { agentName: 'a' }, { agentName: 'c' }])).toEqual(['a', 'b', 'c'])
  })
})
