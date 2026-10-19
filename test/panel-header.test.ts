/**
 * 面板头部 / 操作历史的行为锚点（票 05）。
 *
 * 组件级 seam：用 react-dom/server 渲染静态标记，不依赖宿主 DOM。
 * 覆盖：题头行右侧的工作空间占位、第二行的主要页签（智能体 / 操作历史 / 配置）、
 * 页签选中态与刷新按钮，以及「配置」占位视图与「操作历史」报告呈现。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ConfigPlaceholder } from '../src/dsh/client/config-placeholder.tsx'
import { OperationHistory } from '../src/dsh/client/operation-history.tsx'
import { PanelHeader } from '../src/dsh/client/panel-header.tsx'

import type { WritePlan, WriteReport } from '../src/control/index.ts'

const noop = (): void => {}

function renderHeader(tab: 'agents' | 'history' | 'config'): string {
  return renderToStaticMarkup(h(PanelHeader, {
    tab,
    onTab: noop,
    reload: { status: 'idle' },
    onRefresh: noop,
  }))
}

describe('插件面板头部', () => {
  it('题头行右侧是工作空间占位，主要页签在第二行', () => {
    const html = renderHeader('agents')
    expect(html).toContain('panel-header-top')
    expect(html).toContain('panel-header-tabs-row')
    expect(html).toContain('panel-workspace')
    expect(html).toContain('工作空间选择器（尚未实现）')
    expect(html.indexOf('panel-header-top')).toBeLessThan(html.indexOf('panel-header-tabs-row'))
    expect(html.indexOf('panel-header-tabs-row')).toBeLessThan(html.indexOf('panel-tabs'))
  })

  it('页签顺序为 智能体 → 操作历史 → 配置，刷新按钮仍在操作区', () => {
    const html = renderHeader('agents')
    expect(html).toContain('智能体')
    expect(html).toContain('操作历史')
    expect(html).toContain('配置')
    expect(html.indexOf('panel-tab-agents')).toBeLessThan(html.indexOf('panel-tab-history'))
    expect(html.indexOf('panel-tab-history')).toBeLessThan(html.indexOf('panel-tab-config'))
    expect(html).toContain('aria-label="刷新目录"')
  })

  it('当前页签由 aria-selected 标记', () => {
    expect(renderHeader('agents')).toMatch(/aria-selected="true"[^>]*>智能体<\/button>/)
    expect(renderHeader('history')).toMatch(/aria-selected="true"[^>]*>操作历史<\/button>/)
    expect(renderHeader('config')).toMatch(/aria-selected="true"[^>]*>配置<\/button>/)
  })
})

describe('配置占位视图', () => {
  it('明确标注尚未实现', () => {
    const html = renderToStaticMarkup(h(ConfigPlaceholder, { hidden: false }))
    expect(html).toContain('配置')
    expect(html).toContain('尚未实现')
  })
})

describe('操作历史视图', () => {
  it('空状态说明还没有操作', () => {
    const html = renderToStaticMarkup(h(OperationHistory, { plan: null, reports: [] }))
    expect(html).toContain('操作历史')
    expect(html).toContain('（尚无操作）')
  })

  it('逐条呈现真实 commit 报告', () => {
    const reports: WriteReport[] = [{ results: [{ ok: true, file: '/tmp/default.agent.md' }] }]
    const html = renderToStaticMarkup(h(OperationHistory, { plan: null, reports }))
    expect(html).toContain('已写入')
    expect(html).toContain('/tmp/default.agent.md')
  })

  it('待写入计划与提交报告同屏呈现', () => {
    const plan: WritePlan = {
      entries: [{ file: '/tmp/default.agent.md', content: 'x', blockIds: ['prose'], baseText: 'x' }],
      rejections: [],
    }
    const html = renderToStaticMarkup(h(OperationHistory, { plan, reports: [] }))
    expect(html).toContain('待写入预览')
    expect(html).toContain('/tmp/default.agent.md')
  })
})
