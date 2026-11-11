/**
 * 面板壳四页签的静态渲染锚点（票 60，不依赖宿主 DOM）。
 *
 * 用 react-dom/server 渲一次完整 AgentsWorkspace：四个 tabpanel 都在（保持挂载），
 * 只有当前页签不带 hidden；aria-labelledby 与头部 aria-controls 对齐；registry
 * 两页共用 chunk 的加载态在首帧可见；「配置」占位不再出现。
 *
 * 页面里的 pane 布局在渲染期会读 window / document 的尺寸（SSR 没有），
 * 这里给出最小只读桩；layout effect 在静态渲染中不执行，不需要 ResizeObserver。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { AgentsWorkspace } from '../src/dsh/client/page.tsx'
import { USER_CHOICE } from '../src/dsh/client/workspace-scope.ts'

import type { AgentDefinition, AliasDefinition, ModelDefinition } from '../src/contract/index.ts'
import type { ControlClient, ControlSnapshot } from '../src/control/index.ts'
import type { PanelTab } from '../src/dsh/client/panel-types.ts'

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1280, addEventListener: () => {}, removeEventListener: () => {} }
  g.document = { documentElement: {} }
  g.getComputedStyle = () => ({ fontSize: '16px' })
})

const AGENT: AgentDefinition = {
  agentName: 'fast-agent',
  name: 'Fast Agent',
  description: '',
  body: '',
  source: 'user-dsh',
  origin: 'user',
  providerId: 'fs',
  extra: {},
  path: '/home/u/.dsh/agents/fast-agent/fast-agent.agent.md',
}

const MODEL: ModelDefinition = {
  modelName: 'fast',
  provider: 'acme',
  model: 'chat',
  available: true,
  source: 'user-dsh',
  path: '/home/u/.dsh/agents/registry.yaml',
}

const ALIAS: AliasDefinition = {
  alias: 'fast-alias',
  targets: ['fast'],
  source: 'user-dsh',
  path: '/home/u/.dsh/agents/registry.yaml',
}

const SNAPSHOT: ControlSnapshot = {
  agents: [AGENT],
  models: [MODEL],
  aliases: [ALIAS],
  registryLayers: [],
  agentDiagnostics: [],
  aliasDiagnostics: [],
  findings: [],
  assemblies: {},
  scope: { cwd: null, projectRoot: null },
}

const unused = async (): Promise<never> => { throw new Error('static render must not call the control client') }

const CLIENT: ControlClient = {
  snapshot: async () => SNAPSHOT,
  compose: unused,
  chainReport: unused,
  plan: unused,
  commit: unused,
  applyRegistryEdit: unused,
  invalidate: async () => {},
}

const SCOPE = { readWorkspaces: () => undefined, readSessions: () => undefined }

function renderPage(initialTab: PanelTab): string {
  return renderToStaticMarkup(h(AgentsWorkspace, {
    client: CLIENT,
    initialSnapshot: SNAPSHOT,
    initialChoice: USER_CHOICE,
    scope: SCOPE,
    initialTab,
  }))
}

/** 取出一个 tabpanel 的开标签（用于判断 hidden / aria 关系）。 */
function panelTag(html: string, tab: PanelTab): string {
  const marker = `id="panel-view-${tab}"`
  const at = html.indexOf(marker)
  expect(at, `四个 tabpanel 的稳定 id 都应出现在静态标记里（${tab}）`).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<', at)
  const end = html.indexOf('>', at)
  return html.slice(start, end + 1)
}

const TABS: readonly PanelTab[] = ['agents', 'models', 'prompts', 'history']

describe('面板壳四页签', () => {
  it('四个视图都保持挂载，只有当前页签可见', () => {
    for (const current of TABS) {
      const html = renderPage(current)
      for (const tab of TABS) {
        expect(panelTag(html, tab)).toContain(`aria-labelledby="panel-tab-${tab}"`)
        if (tab === current) expect(panelTag(html, tab)).not.toContain('hidden')
        else expect(panelTag(html, tab)).toContain('hidden')
      }
      // 操作历史即便隐藏也渲染内容（保持挂载的证据）。
      expect(html).toContain('（尚无操作）')
      // 智能体列表 chunk 始终挂载（列表加载态文案在四个页签下都在）。
      expect(html).toContain('列表加载中…')
    }
  })

  it('两个 registry 页共用 chunk 的加载态首帧可见', () => {
    const html = renderPage('models')
    expect(html).toContain('模型关联加载中…')
    expect(html).toContain('系统提示词加载中…')
    // 两页的 tabpanel 容器都带命名空间类，aria 关系由页面持有。
    expect(html).toContain('registry-view')
  })

  it('「配置」占位已退场，头部只剩四个页签', () => {
    const html = renderPage('agents')
    expect(html).not.toContain('配置')
    for (const tab of TABS) expect(html).toContain(`id="panel-tab-${tab}"`)
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1)
  })

  it('各页签的 aria-controls 与 tabpanel 的 aria-labelledby 一致', () => {
    const html = renderPage('prompts')
    for (const tab of TABS) {
      expect(html).toContain(`aria-controls="panel-view-${tab}"`)
      expect(panelTag(html, tab)).toContain(`aria-labelledby="panel-tab-${tab}"`)
    }
  })
})
