/**
 * 面板头部 / 选择器 / 操作历史的行为锚点（票 05；票 37 扩展）。
 *
 * 组件级 seam：用 react-dom/server 渲染静态标记，不依赖宿主 DOM。
 * 覆盖：题头行的页面标题与工作空间选择器（三态）、页签行（智能体 / 操作历史 /
 * 配置）+ 状态区 + 刷新按钮、选择器选项列表的 ARIA 关系、配置占位与操作历史。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ConfigPlaceholder } from '../src/dsh/client/config-placeholder.tsx'
import { OperationHistory } from '../src/dsh/client/operation-history.tsx'
import { PanelHeader } from '../src/dsh/client/panel-header.tsx'
import { panelViewId } from '../src/dsh/client/panel-types.ts'
import { USER_CHOICE } from '../src/dsh/client/workspace-scope.ts'
import { WORKSPACE_LIST_ID, WorkspaceListbox, workspaceChoiceLabel, workspaceOptionId, workspaceSelectKey } from '../src/dsh/client/workspace-select.tsx'

import type { WritePlan } from '../src/control/index.ts'
import type { HistoryEntry } from '../src/dsh/client/operation-history.tsx'
import type { PanelHeaderScope } from '../src/dsh/client/panel-header.tsx'
import type { WorkspaceChoice } from '../src/dsh/client/workspace-scope.ts'

const noop = (): void => {}

const ALPHA: WorkspaceChoice = { kind: 'workspace', workspaceId: 'ws-alpha', title: 'Alpha 工作区', path: '/work/alpha' }

function defaultScope(overrides: Partial<PanelHeaderScope> = {}): PanelHeaderScope {
  return { choice: USER_CHOICE, choices: [USER_CHOICE], status: 'ready', ...overrides }
}

function renderHeader(tab: 'agents' | 'history' | 'config', scope: PanelHeaderScope = defaultScope()): string {
  return renderToStaticMarkup(h(PanelHeader, {
    tab,
    onTab: noop,
    reload: { status: 'idle' },
    onRefresh: noop,
    scope,
    onSelectWorkspace: noop,
  }))
}

describe('插件面板头部', () => {
  it('题头行右侧是工作空间选择器，主要页签在第二行', () => {
    const html = renderHeader('agents')
    expect(html).toContain('panel-header-top')
    expect(html).toContain('panel-header-tabs-row')
    expect(html).toContain('panel-workspace')
    expect(html).toContain('用户全局')
    expect(html.indexOf('panel-header-top')).toBeLessThan(html.indexOf('panel-header-tabs-row'))
    expect(html.indexOf('panel-header-tabs-row')).toBeLessThan(html.indexOf('panel-tabs'))
  })

  it('选择器是 listbox combobox 形态：闭合时不指向不存在的弹层', () => {
    const html = renderHeader('agents', defaultScope({ choice: ALPHA, choices: [USER_CHOICE, ALPHA] }))
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="false"')
    // 弹层只在展开时挂载：闭合态的 aria-controls 会指向不存在的 id（悬空引用）。
    expect(html).not.toContain(`aria-controls="${WORKSPACE_LIST_ID}"`)
    expect(html).not.toContain('aria-activedescendant')
    expect(html).toContain('Alpha 工作区')
  })

  it('列表不可用时触发件带警示态，并把原因写进状态区', () => {
    const html = renderHeader('agents', defaultScope({
      status: 'unavailable',
      notice: { severity: 'warn', text: '工作区列表不可用' },
    }))
    expect(html).toContain('panel-workspace warn')
    expect(html).toContain('工作区列表不可用')
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

  it('aria-controls 指向三个视图共用的稳定 id', () => {
    const html = renderHeader('agents')
    expect(html).toContain('aria-controls="panel-view-agents"')
    expect(html).toContain('aria-controls="panel-view-history"')
    expect(html).toContain('aria-controls="panel-view-config"')
    expect(panelViewId('agents')).toBe('panel-view-agents')
  })
})

describe('工作空间选择器选项', () => {
  it('选项列表带 role=option、勾选态与路径副行', () => {
    const html = renderToStaticMarkup(h(WorkspaceListbox, {
      choices: [USER_CHOICE, ALPHA],
      selectedKey: ALPHA.workspaceId,
      activeIndex: 1,
      listId: WORKSPACE_LIST_ID,
      onSelect: noop,
      onHover: noop,
    }))
    expect(html).toContain('role="listbox"')
    expect(html).toContain(`id="${WORKSPACE_LIST_ID}"`)
    expect(html).toContain(`id="${workspaceOptionId(0)}"`)
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('/work/alpha')
    expect(html).toContain('只扫用户级与随包根')
  })

  it('标题为空时回退到路径末段', () => {
    expect(workspaceChoiceLabel({ ...ALPHA, title: '  ' })).toBe('alpha')
    expect(workspaceChoiceLabel(USER_CHOICE)).toBe('用户全局')
  })

  it('键盘契约：关闭时打开、打开时循环 / 首尾 / 选择 / 关闭回焦', () => {
    const closed = workspaceSelectKey({ open: false, active: 0, count: 3 }, 'ArrowDown')
    expect(closed).toMatchObject({ handled: true, open: true, active: 0 })
    expect(workspaceSelectKey({ open: false, active: 0, count: 3 }, 'ArrowUp')).toMatchObject({ open: true, active: 2 })
    expect(workspaceSelectKey({ open: false, active: 0, count: 3 }, 'a').handled).toBe(false)

    expect(workspaceSelectKey({ open: true, active: 2, count: 3 }, 'ArrowDown')).toMatchObject({ active: 0 })
    expect(workspaceSelectKey({ open: true, active: 0, count: 3 }, 'ArrowUp')).toMatchObject({ active: 2 })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'Home')).toMatchObject({ active: 0 })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'End')).toMatchObject({ active: 2 })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'Enter')).toMatchObject({ select: true })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, ' ')).toMatchObject({ select: true })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'Escape')).toMatchObject({ open: false, refocus: true })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'Tab')).toMatchObject({ open: false, refocus: false })
    // 空列表也要能开、能关（选择器会兜底成「用户全局」一项）。
    expect(workspaceSelectKey({ open: false, active: 0, count: 0 }, 'Enter')).toMatchObject({ open: true, active: 0 })
  })

  it('Tab 只关弹层，不吃浏览器的默认焦点移动', () => {
    // 注释承诺「Tab 关闭并让焦点自然离开」：关弹层但必须放行默认行为，
    // 否则焦点停在触发件上，用户得按两次 Tab。
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'Tab'))
      .toMatchObject({ handled: true, preventDefault: false, open: false })
  })

  it('其余被认领的键仍然吃掉默认行为', () => {
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'ArrowDown')).toMatchObject({ preventDefault: true })
    expect(workspaceSelectKey({ open: true, active: 1, count: 3 }, 'Escape')).toMatchObject({ preventDefault: true })
    expect(workspaceSelectKey({ open: false, active: 0, count: 3 }, 'Enter')).toMatchObject({ preventDefault: true })
    expect(workspaceSelectKey({ open: false, active: 0, count: 3 }, 'a')).toMatchObject({ handled: false, preventDefault: false })
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

  it('逐条呈现真实 commit 报告与产生它的工作空间', () => {
    const reports: HistoryEntry[] = [{ report: { results: [{ ok: true, file: '/tmp/default.agent.md' }] }, workspace: 'Alpha 工作区' }]
    const html = renderToStaticMarkup(h(OperationHistory, { plan: null, reports }))
    expect(html).toContain('已写入')
    expect(html).toContain('/tmp/default.agent.md')
    expect(html).toContain('Alpha 工作区')
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
